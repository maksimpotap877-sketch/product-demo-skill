import path from 'node:path';
import {readFile, access} from 'node:fs/promises';
import {z} from 'zod';
import {hash, probe, readJson, safeFile, writeJson} from './util.js';

const criteria = ['content', 'framing', 'motion', 'audio'] as const;
const ReviewCheck = z.object({
  criterion: z.enum(criteria),
  status: z.enum(['passed', 'failed', 'not-tested']),
  method: z.enum(['not-performed', 'frames-and-source', 'normal-speed-playback', 'listening']),
  coverage: z.array(z.object({startSec: z.number().nonnegative(), endSec: z.number().positive()}).strict()),
  notes: z.string().min(1),
}).strict();
export const EditorialReviewSchema = z.object({
  schemaVersion: z.literal(1),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  durationSec: z.number().positive(),
  reviewer: z.string().min(1),
  reviewedAt: z.string().datetime(),
  checks: z.array(ReviewCheck).length(criteria.length),
  defects: z.array(z.object({
    atSec: z.number().nonnegative(), criterion: z.enum(criteria),
    symptom: z.string().min(1), correction: z.string(),
    status: z.enum(['open', 'resolved']), evidence: z.string().min(1),
  }).strict()),
}).strict().superRefine((r, ctx) => {
  if (new Set(r.checks.map(c => c.criterion)).size !== criteria.length)
    ctx.addIssue({code: 'custom', message: 'Each editorial criterion must appear exactly once.'});
  for (const c of r.checks) {
    if (c.coverage.some(v => v.endSec <= v.startSec || v.endSec > r.durationSec + 0.05))
      ctx.addIssue({code: 'custom', message: `${c.criterion}: coverage outside artifact duration.`});
    if (c.status !== 'passed') continue;
    const required = c.criterion === 'motion' ? 'normal-speed-playback' : c.criterion === 'audio' ? 'listening' : 'frames-and-source';
    if (c.method !== required) ctx.addIssue({code: 'custom', message: `${c.criterion}: passed requires ${required}, not technical inference.`});
    if (!c.coverage.length) ctx.addIssue({code: 'custom', message: `${c.criterion}: inspected intervals required.`});
    if (c.criterion === 'motion' || c.criterion === 'audio') {
      let end = 0;
      for (const v of [...c.coverage].sort((a, b) => a.startSec - b.startSec)) {
        if (v.startSec > end + 0.05) break;
        end = Math.max(end, v.endSec);
      }
      if (end < r.durationSec - 0.05) ctx.addIssue({code: 'custom', message: `${c.criterion}: a pass requires complete normal-speed review; sampled checks remain not-tested with notes.`});
    }
    if (r.defects.some(d => d.criterion === c.criterion && d.status === 'open'))
      ctx.addIssue({code: 'custom', message: `${c.criterion}: unresolved defect cannot pass.`});
  }
  if (r.defects.some(d => d.atSec > r.durationSec)) ctx.addIssue({code: 'custom', message: 'Defect time exceeds artifact duration.'});
});

async function artifact(runDir: string, profile?: string) {
  const plan = await readJson(path.join(runDir, profile ? `edit-plan-${profile}.json` : 'edit-plan.json'));
  const render = await readJson(path.join(runDir, `renders/render-${plan.profile.name}.json`));
  const file = await safeFile(runDir, path.relative(runDir, render.file));
  return {file, profile: plan.profile.name, artifactSha256: hash(await readFile(file)), durationSec: Number((await probe(file)).format.duration)};
}

export async function createReviewDraft(runDir: string, profile?: string) {
  const a = await artifact(runDir, profile);
  const file = path.join(runDir, 'review', `editorial-review-${a.profile}.draft.json`);
  try {await access(file); throw new Error('Review draft exists; preserve it and edit the existing file.');}
  catch (e: any) {if (e.code !== 'ENOENT') throw e;}
  await writeJson(file, {schemaVersion: 1, artifactSha256: a.artifactSha256, durationSec: a.durationSec,
    reviewer: 'Replace with actual reviewer', reviewedAt: new Date().toISOString(),
    checks: criteria.map(criterion => ({criterion, status: 'not-tested', method: 'not-performed', coverage: [], notes: 'No review performed. Do not infer a pass from rendering or frame counts.'})), defects: []});
  return {file, artifact: a.file, deliveryStatus: 'review-candidate', next: 'Review the exact MP4, edit only checks actually performed, then review --file <draft> and inspect.'};
}

export function validateEditorialArtifact(input: unknown, sha256: string, durationSec: number) {
  const review = EditorialReviewSchema.parse(input);
  if (review.artifactSha256 !== sha256) throw new Error('Editorial review belongs to a different export. Review the current MP4.');
  if (Math.abs(review.durationSec - durationSec) > 0.05) throw new Error('Editorial review duration differs from the current MP4.');
  return review;
}

export async function importEditorialReview(runDir: string, file: string, profile?: string) {
  const a = await artifact(runDir, profile);
  const review = validateEditorialArtifact(await readJson(file), a.artifactSha256, a.durationSec);
  const saved = path.join(runDir, 'review', `editorial-review-${a.profile}.json`);
  await writeJson(saved, review);
  return {file: saved, deliveryStatus: editorialDelivery(review), evidenceType: 'Reviewer declaration tied to MP4 bytes; not independent proof that playback/listening occurred.'};
}

export function editorialDelivery(review?: z.infer<typeof EditorialReviewSchema>) {
  if (review?.checks.some(c => c.status === 'failed') || review?.defects.some(d => d.status === 'open')) return 'changes-required' as const;
  return review?.checks.every(c => c.status === 'passed') ? 'reviewed' as const : 'review-candidate' as const;
}

export async function editorialChecks(runDir: string, profile: string, sha256: string, durationSec: number) {
  const file = path.join(runDir, 'review', `editorial-review-${profile}.json`);
  let review: z.infer<typeof EditorialReviewSchema> | undefined;
  try {review = validateEditorialArtifact(await readJson(file), sha256, durationSec);}
  catch (e: any) {
    if (e.code !== 'ENOENT') return {deliveryStatus: 'review-candidate' as const, checks: [{name: 'editorial-review-current-artifact', status: 'not-tested', method: 'Review invalidated by changed export or invalid evidence', evidence: e.message}]};
  }
  return {deliveryStatus: editorialDelivery(review), checks: criteria.map(criterion => {
    const c = review?.checks.find(c => c.criterion === criterion);
    return {name: `editorial-${criterion}`, status: c?.status ?? 'not-tested', method: c?.method ?? 'not-performed', evidence: c ? {file, reviewer: review!.reviewer, coverage: c.coverage, notes: c.notes, evidenceType: 'reviewer declaration'} : 'Use review --init; frames do not prove normal-speed motion or subjective audio quality.'};
  })};
}
