import assert from 'node:assert/strict';
import {mkdir, readFile, cp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import {EditPlanSchema} from '../src/schema.js';
import {sceneGeometry, videoTiming} from '../src/render/motion.js';
import {hash, run, writeJson} from '../src/util.js';
import {resolveRenderBrowser} from '../src/rendering.js';

// Real renders compare source pixels to an independently timed 1x reference, so
// identical blank hold frames cannot accidentally pass this regression.
const dir = path.resolve('test-output/render-freeze-speed');
await mkdir(dir, {recursive: true});
await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=128x72:r=60', '-t', '1', '-c:v', 'libx264', path.join(dir, 'source.mp4')]);
const base = EditPlanSchema.parse({schemaVersion: 1, runId: 'freeze-proof', toolVersion: 'test', profile: {name: 'test', width: 640, height: 360, fps: 60}, durationFrames: 120, transitionFrames: 0, presentation: 'cinematic', title: 'Freeze test', accent: '#7666ec', viewportCss: {width: 128, height: 72}, sourcePixels: {width: 128, height: 72}, scenes: [{sceneId: 'video', kind: 'video', sourcePath: 'source.mp4', holdPath: 'nonexistent-incorrect-screenshot.png', sourcePixels: {width: 128, height: 72}, sourceStartMs: 100, sourceEndMs: 600, sourceDurationMs: 1000, outputStartFrame: 0, outputDurationFrames: 120, playbackRate: 1, voiceDurationMs: 0, layout: 'product', title: 'Exact last frame', caption: '', camera: [{frame: 0, scale: 1, x: .5, y: .5}], events: []}], provenance: ['Generated offline test pattern']});
const browser = await resolveRenderBrowser();
const legacy = process.argv.includes('--verify-legacy-failure');
let entryPoint = path.resolve('dist/render/index.js');
if (legacy) {
  const copied = path.join(dir, 'legacy-renderer');
  await cp(path.resolve('dist/render'), copied, {recursive: true});
  const file = path.join(copied, 'Surface.js'), current = await readFile(file, 'utf8');
  assert.ok(current.includes('trimBefore: timing.trimBefore, playbackRate:'));
  await writeFile(file, current.replace('trimBefore: timing.trimBefore, playbackRate:', 'trimBefore: timing.trimBefore, trimAfter: timing.trimAfter, playbackRate:'));
  entryPoint = path.join(copied, 'index.js');
}
const serveUrl = await bundle({entryPoint, publicDir: dir});
const composition = await selectComposition({serveUrl, id: 'ProductDemo', inputProps: {plan: base}, ...browser, logLevel: 'error'});
const box = sceneGeometry(base, base.scenes[0]).box;
const crop = `${Math.floor(box.width) - 20}:${Math.floor(box.height) - 20}:${Math.ceil(box.x) + 10}:${Math.ceil(box.y) + 10}`;
async function pixels(plan: typeof base, frame: number, name: string) {
  const prefix = legacy ? 'legacy-' : '';
  const output = path.join(dir, `${prefix}${name}.png`), cropped = path.join(dir, `${prefix}${name}-source.png`);
  await renderStill({serveUrl, composition: {...composition, props: {plan}}, inputProps: {plan}, frame, output, imageFormat: 'png', ...browser, logLevel: 'error'});
  await run('ffmpeg', ['-y', '-v', 'error', '-i', output, '-vf', `crop=${crop}`, '-frames:v', '1', cropped]);
  return hash(await readFile(cropped));
}
const cases = [];
for (const playbackRate of [.5, 1, 2]) {
  const plan = structuredClone(base); plan.scenes[0].playbackRate = playbackRate;
  const timing = videoTiming(plan.scenes[0], plan.profile.fps);
  const frames = [Math.floor(timing.lastFrame / 3), timing.lastFrame, timing.playableFrames, 119];
  const hashes: Record<number, string> = {};
  for (const frame of frames) hashes[frame] = await pixels(plan, frame, `rate-${playbackRate}-frame-${frame}`);
  const expectedSourceMs = plan.scenes[0].sourceStartMs + timing.lastFrame / plan.profile.fps * 1000 * playbackRate;
  const reference = structuredClone(base);
  reference.scenes[0].sourceStartMs = expectedSourceMs;
  reference.scenes[0].sourceEndMs = expectedSourceMs + 100;
  const expectedHash = await pixels(reference, 0, `rate-${playbackRate}-expected-source`);
  const passed = hashes[frames[0]] !== expectedHash && hashes[timing.lastFrame] === expectedHash && hashes[timing.playableFrames] === expectedHash && hashes[119] === expectedHash;
  cases.push({playbackRate, frames, hashes, expectedSourceMs, expectedHash, status: passed ? 'passed' : 'failed'});
}
const status = cases.every(item => item.status === 'passed') ? 'passed' : 'failed';
await writeJson(path.join(dir, legacy ? 'proof-legacy-failure.json' : 'proof.json'), {status, cases, browser, method: 'Real Remotion PNG source crops at early/last-moving/first-hold/late-hold frames, compared to independent 1x source-time render; exact pixels and continued visible source are required', subjectiveMotion: 'not-tested'});
if (legacy) {
  assert.equal(cases.find(item => item.playbackRate === .5)?.status, 'failed', 'The restored legacy trimAfter must reproduce the slowdown defect.');
  assert.equal(cases.find(item => item.playbackRate === 1)?.status, 'passed');
  process.stdout.write('render-freeze legacy regression reproduced:0.5x loses source pixels before hold\n');
} else {
  assert.equal(status, 'passed', JSON.stringify(cases, null, 2));
  process.stdout.write('render-freeze integration passed: actual0.5x,1x and2x final source pixels retained through hold\n');
}
