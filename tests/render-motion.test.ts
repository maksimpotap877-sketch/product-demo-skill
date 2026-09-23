import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EditPlanSchema, type EditPlan} from '../src/schema.js';
import {cameraPose, inspectMotionGeometry, projectPoint, sampleCamera, sceneGeometry, smoothStep, videoTiming} from '../src/render/motion.js';
import {renderCodeFingerprint} from '../src/rendering.js';

const plan = (width = 1920, height = 1080) => EditPlanSchema.parse({schemaVersion: 1, runId: 'motion-test', toolVersion: 'test', profile: {name: 'test', width, height, fps: 60}, durationFrames: 240, transitionFrames: 0, presentation: 'cinematic', title: 'Test', accent: '#7666ec', viewportCss: {width: 1600, height: 900}, sourcePixels: {width: 1600, height: 900}, scenes: [{sceneId: 'one', kind: 'screenshot', sourcePath: 'source.png', sourceStartMs: 0, sourceEndMs: 1000, sourceDurationMs: 1000, outputStartFrame: 0, outputDurationFrames: 240, playbackRate: 1, voiceDurationMs: 0, title: 'Test', caption: '', layout: 'product', camera: [{frame: 0, scale: 1, x: .5, y: .5}], events: []}], provenance: []});

test('every output/source aspect preserves the complete source at scale one inside the canvas', () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080]]) for (const [sw, sh] of [[1600, 900], [900, 1600], [1000, 1000], [2560, 1080]]) for (const layout of ['hero', 'product', 'detail', 'outro'] as const) {
    const p = plan(w, h), scene = {...p.scenes[0], layout, sourcePixels: {width: sw, height: sh}};
    const {box, area} = sceneGeometry(p, scene);
    assert.ok(Math.abs(box.width / box.height - sw / sh) < 1e-9);
    assert.ok(box.x >= area.x - 1e-7 && box.y >= area.y - 1e-7);
    assert.ok(box.x + box.width <= area.x + area.width + 1e-7 && box.y + box.height <= area.y + area.height + 1e-7);
    const pose = cameraPose(box, scene.camera[0]);
    for (const corner of [{x: 0, y: 0}, {x: 1, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}]) {
      const visible = projectPoint(corner, box, pose);
      assert.ok(visible.x >= 0 && visible.x <= box.width && visible.y >= 0 && visible.y <= box.height);
    }
  }
});

test('landscape product/detail share the same readable 1536x864 source rectangle', () => {
  const p = plan();
  const a = sceneGeometry(p, p.scenes[0]), b = sceneGeometry(p, {...p.scenes[0], layout: 'detail'});
  assert.deepEqual(a.box, b.box);
  assert.equal(a.box.width, 1536); assert.equal(a.box.height, 864);
  assert.ok(Math.abs(a.box.x - 192) < 1e-7); assert.ok(Math.abs(a.box.y - 102.6) < 1e-7);
});

test('interpolated camera remains contained, finishes at rest and keeps pointer/source landmarks identical', () => {
  const size = {width: 1536, height: 864};
  const keys = [{frame: 0, scale: 1, x: .5, y: .5}, {frame: 120, scale: 1.2, x: .1, y: .9}, {frame: 239, scale: 1.2, x: .1, y: .9}];
  for (let frame = 0; frame < 240; frame++) {
    const pose = sampleCamera(keys, frame, size);
    assert.ok(pose.tx <= 1e-7 && pose.tx >= size.width * (1 - pose.scale) - 1e-7);
    assert.ok(pose.ty <= 1e-7 && pose.ty >= size.height * (1 - pose.scale) - 1e-7);
    const marker = {x: .72, y: .34}, screen = projectPoint(marker, size, pose);
    assert.ok(Math.abs((screen.x - pose.tx) / (size.width * pose.scale) - marker.x) < 1e-9);
    assert.ok(Math.abs((screen.y - pose.ty) / (size.height * pose.scale) - marker.y) < 1e-9);
  }
  assert.deepEqual(sampleCamera(keys, 180, size), sampleCamera(keys, 239, size));
  assert.ok(Math.abs(sampleCamera(keys, 120, size).ty - sampleCamera(keys, 119, size).ty) < .002);
  assert.equal(smoothStep(0), 0); assert.equal(smoothStep(1), 1);
});

test('motion preflight rejects whiplash while a deliberate settled move passes', () => {
  const p = plan();
  p.scenes[0].camera = [{frame: 0, scale: 1, x: .5, y: .5}, {frame: 120, scale: 1.2, x: .55, y: .5}, {frame: 239, scale: 1.2, x: .55, y: .5}];
  assert.equal(inspectMotionGeometry(p).status, 'passed');
  p.scenes[0].camera = [{frame: 0, scale: 1, x: .5, y: .5}, {frame: 10, scale: 2, x: .8, y: .8}];
  const result = inspectMotionGeometry(p);
  assert.equal(result.status, 'failed');
  assert.ok(result.issues.some(issue => issue.includes('shorter')));
  assert.ok(result.issues.some(issue => issue.includes('zoom exceeds')));
});

test('fractional source cuts and playback rates freeze the last in-range output sample', () => {
  for (const fps of [25, 60, 144]) for (const playbackRate of [.5, 1, 1.7, 2]) {
    const scene = {sourceStartMs: 123, sourceEndMs: 877, playbackRate};
    const timing = videoTiming(scene, fps);
    const sampledMs = timing.lastFrame / fps * 1000 * playbackRate + scene.sourceStartMs;
    assert.ok(sampledMs < scene.sourceEndMs);
    assert.ok(sampledMs + 1000 / fps * playbackRate >= scene.sourceEndMs - 1e-7);
    assert.equal(timing.playableFrames, Math.ceil((877 - 123) / playbackRate * fps / 1000 - 1e-8));
  }
});

test('renderer cache fingerprint includes newly added nested renderer helpers', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'demo-render-code-'));
  try {
    await mkdir(path.join(dir, 'dist/render/nested'), {recursive: true});
    for (const file of ['render/Composition.js', 'render/nested/helper.js', 'rendering.js', 'render-input.js', 'audio.js']) await writeFile(path.join(dir, 'dist', file), 'initial');
    const before = await renderCodeFingerprint(dir);
    await writeFile(path.join(dir, 'dist/render/nested/helper.js'), 'changed geometry');
    const after = await renderCodeFingerprint(dir);
    assert.notDeepEqual(after, before);
    assert.ok(after.some(entry => entry.file === 'dist/render/nested/helper.js'));
  } finally {await rm(dir, {recursive: true, force: true});}
});
