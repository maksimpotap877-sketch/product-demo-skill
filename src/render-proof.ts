import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {type EditPlan} from './schema.js';
import {run} from './util.js';

type Pixel = [number, number, number];
export interface LayerFrameEvidence {frame: number; ptsMs: number; expectedEdgePx: number; measuredEdgePx: number; colorContrast: number; cropSha256: string}
const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** Estimates coverage at the single known solid progress-layer edge, not arbitrary pixel changes. */
export function progressEdge(rgb: Uint8Array, width: number, height: number, expectedEdge: number) {
  const column = (x: number): Pixel => {
    const c: Pixel = [0, 0, 0];
    // Bottom two rows avoid the 4px bar's upper YUV chroma boundary.
    for (let y = Math.max(0, height - 2); y < height; y++) for (let channel = 0; channel < 3; channel++) c[channel] += rgb[(y * width + x) * 3 + channel] / Math.min(height, 2);
    return c;
  };
  const average = (left: number, right: number): Pixel => {
    const result: Pixel = [0, 0, 0]; const count = right - left;
    for (let x = left; x < right; x++) {const c = column(x); for (let k = 0; k < 3; k++) result[k] += c[k] / count;}
    return result;
  };
  if (expectedEdge < 52 || expectedEdge > width - 52) throw new Error('Progress edge is too near the frame boundary for reliable color calibration.');
  const edge = Math.floor(expectedEdge);
  const foreground = average(edge - 48, edge - 32), background = average(edge + 32, edge + 48);
  const direction = background.map((v, i) => v - foreground[i]);
  const norm = direction.reduce((sum, v) => sum + v * v, 0);
  if (Math.sqrt(norm) < 35) throw new Error('Progress-layer contrast is too low for reliable edge measurement.');
  const left = edge - 12, right = edge + 13;
  let coverage = 0;
  for (let x = left; x < right; x++) {
    const c = column(x);
    coverage += clamp(c.reduce((sum, v, i) => sum + (background[i] - v) * direction[i], 0) / norm);
  }
  return {edge: left + coverage, contrast: Math.sqrt(norm)};
}

export function evaluateProgressFrames(frames: LayerFrameEvidence[], expectedStepPx: number, fps: number) {
  if (frames.length < Math.min(30, fps * 0.75)) return {status: 'degraded' as const, reason: 'Insufficient consecutive decoded frames', criteria: {}, metrics: {count: frames.length}};
  const minAdvancePx = Math.max(0.15, expectedStepPx * 0.3);
  const steps = frames.slice(1).map((f, i) => f.measuredEdgePx - frames[i].measuredEdgePx);
  const observedFraction = steps.filter(v => v > minAdvancePx).length / steps.length;
  const monotonicFraction = steps.filter(v => v >= -0.1).length / steps.length;
  const first = frames[0], last = frames.at(-1)!;
  const expectedSpan = last.expectedEdgePx - first.expectedEdgePx;
  const measuredSpan = last.measuredEdgePx - first.measuredEdgePx;
  const slopeRatio = measuredSpan / expectedSpan;
  const errors = frames.map(f => f.measuredEdgePx - f.expectedEdgePx);
  const bias = errors.reduce((sum, e) => sum + e, 0) / errors.length;
  const rmsePx = Math.sqrt(errors.reduce((sum, e) => sum + (e - bias) ** 2, 0) / errors.length);
  const maxErrorPx = Math.max(...errors.map(Math.abs));
  const ptsGapsMs = frames.slice(1).map((f, i) => f.ptsMs - frames[i].ptsMs);
  const ptsRegular = ptsGapsMs.every(gap => Math.abs(gap - 1000 / fps) < 0.15);
  const criteria = {minimumOrderedAdvanceFraction: 0.9, minimumMonotonicFraction: 0.98, minAdvancePx, maximumCenteredRmsePx: 0.55, maximumAbsoluteErrorPx: 2, slopeRatioRange: [0.94, 1.06], maximumPtsErrorMs: 0.15};
  const passed = observedFraction >= criteria.minimumOrderedAdvanceFraction && monotonicFraction >= criteria.minimumMonotonicFraction && slopeRatio >= 0.94 && slopeRatio <= 1.06 && rmsePx <= criteria.maximumCenteredRmsePx && maxErrorPx <= criteria.maximumAbsoluteErrorPx && ptsRegular;
  return {status: passed ? 'passed' as const : 'degraded' as const, reason: passed ? 'Sampled rendered progress layer advances at the composition frame cadence with spatial agreement.' : 'Decoded progress edge does not provide sufficient evidence of a new ordered state at the composition cadence.', criteria, metrics: {count: frames.length, expectedStepPx, observedFraction, monotonicFraction, expectedSpanPx: expectedSpan, measuredSpanPx: measuredSpan, slopeRatio, centeredRmsePx: rmsePx, edgeBiasPx: bias, maxErrorPx, ptsRegular, minMeasuredStepPx: Math.min(...steps), maxMeasuredStepPx: Math.max(...steps)}};
}

async function decodeCrop(file: string, width: number, height: number, start: number, count: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-i', file, '-vf', `trim=start_frame=${start}:end_frame=${start + count},crop=${width}:4:0:${height - 4},format=rgb24`, '-frames:v', String(count), '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
    const child = spawn('ffmpeg', args, {shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const buffers: Buffer[] = []; let length = 0, stderr = '';
    const timer = setTimeout(() => {child.kill(); reject(new Error('Render-layer crop decode timed out.'));}, 120_000);
    child.stdout.on('data', (chunk: Buffer) => {buffers.push(chunk); length += chunk.length; if (length > width * 4 * 3 * (count + 2)) {child.kill(); reject(new Error('Unexpected decoded crop size.'));}});
    child.stderr.on('data', chunk => {stderr = (stderr + String(chunk)).slice(-1000);});
    child.once('error', e => {clearTimeout(timer); reject(e);});
    child.once('close', code => {clearTimeout(timer); code === 0 ? resolve(Buffer.concat(buffers)) : reject(new Error(`Crop decode failed: ${stderr}`));});
  });
}

export async function verifyRenderLayers(file: string, plan: EditPlan) {
  const base = {schemaVersion: 1, runId: plan.runId, checkedAt: new Date().toISOString(), profile: plan.profile.name, renderFps: plan.profile.fps, method: 'Consecutive decoded final-MP4 frames, calibrated solid progress-bar edge coverage, expected absolute-frame geometry and PTS comparison. Compression-noise hashes alone never count as new states.', scope: 'Only the sampled Remotion progress layer. This is not proof of native browser capture fps, all camera motion, subjective smoothness, or playback capability.', subjectiveMotion: 'not-tested', nativeCaptureClaim: false};
  if(plan.presentation==='cinematic')return {...base,status:'not-tested' as const,reason:'Cinematic preset deliberately has no progress bar. Ordered camera movement requires separate motion review; output frame rate alone is not proof.',frames:[]};
  try {
    const fps = plan.profile.fps, width = plan.profile.width, height = plan.profile.height;
    const candidates = plan.scenes.map(s => ({sceneId: s.sceneId, first: s.outputStartFrame + plan.transitionFrames + 2, last: s.outputStartFrame + s.outputDurationFrames - plan.transitionFrames - 2})).filter(s => s.last - s.first >= Math.min(fps, 30));
    if (!candidates.length) return {...base, status: 'degraded', reason: 'No sufficiently long transition-free interval.', frames: []};
    const selected = candidates.sort((a, b) => (b.last - b.first) - (a.last - a.first))[0];
    const count = Math.min(fps, selected.last - selected.first);
    const start = Math.floor((selected.first + selected.last - count) / 2);
    const raw = await decodeCrop(file, width, height, start, count);
    const stride = width * 4 * 3;
    if (raw.length !== stride * count) return {...base, status: 'degraded', reason: 'Unexpected decoded crop frame count.', expectedCount: count, actualCount: raw.length / stride, frames: []};
    const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', file], {timeoutMs: 120_000})).stdout);
    const pts = probe.frames.map((f: {best_effort_timestamp_time: string}) => Number(f.best_effort_timestamp_time) * 1000);
    const frames: LayerFrameEvidence[] = [];
    for (let i = 0; i < count; i++) {
      const frame = start + i;
      const crop = raw.subarray(i * stride, (i + 1) * stride);
      const expectedEdgePx = width * frame / plan.durationFrames;
      const measured = progressEdge(crop, width, 4, expectedEdgePx);
      frames.push({frame, ptsMs: pts[frame], expectedEdgePx, measuredEdgePx: measured.edge, colorContrast: measured.contrast, cropSha256: createHash('sha256').update(crop).digest('hex')});
    }
    return {...base, sceneId: selected.sceneId, sampleRange: {startFrame: start, endFrameExclusive: start + count, durationSec: count / fps}, ...evaluateProgressFrames(frames, width / plan.durationFrames, fps), frames};
  } catch (error) {return {...base, status: 'degraded', reason: error instanceof Error ? error.message : String(error), frames: []};}
}
