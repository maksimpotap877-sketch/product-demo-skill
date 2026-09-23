import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EditPlanSchema} from '../src/schema.js';
import {hash, writeJson} from '../src/util.js';
import {assertCurrentRender, currentRenderCacheKey} from '../src/render-identity.js';
import {renderCodeFingerprint} from '../src/rendering.js';
import {previewQuality} from '../src/preview.js';
import {inspectRun} from '../src/qa.js';

async function fixture(action: (dir: string, packageRoot: string, plan: ReturnType<typeof EditPlanSchema.parse>) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'demo-current-export-'));
  const packageRoot = path.join(dir, 'toolkit');
  try {
    await mkdir(path.join(packageRoot, 'dist/render'), {recursive: true});
    for (const file of ['render/Composition.js', 'rendering.js', 'render-input.js', 'audio.js']) await writeFile(path.join(packageRoot, 'dist', file), 'renderer fixture');
    await writeFile(path.join(dir, 'source.png'), 'source fixture');
    await writeFile(path.join(dir, 'voice.wav'), 'voice fixture');
    await writeFile(path.join(dir, 'music.wav'), 'music fixture');
    await writeJson(path.join(dir, 'resolved-config.json'), {project: dir, musicFile: 'music.wav'});
    const plan = EditPlanSchema.parse({schemaVersion: 1, runId: 'fixture', toolVersion: 'test', profile: {name: 'test', width: 640, height: 360, fps: 60}, durationFrames: 180, transitionFrames: 0, title: 'Before', accent: '#7666ec', viewportCss: {width: 640, height: 360}, sourcePixels: {width: 640, height: 360}, scenes: [{sceneId: 'one', kind: 'screenshot', sourcePath: 'source.png', sourceStartMs: 0, sourceEndMs: 1, sourceDurationMs: 1, outputStartFrame: 0, outputDurationFrames: 180, playbackRate: 1, voicePath: 'voice.wav', voiceDurationMs: 1000, title: 'Before', caption: 'Fixture', camera: [{frame: 0, scale: 1, x: .5, y: .5}], events: []}], provenance: []});
    await action(dir, packageRoot, plan);
  } finally {await rm(dir, {recursive: true, force: true});}
}

test('inspection cache identity matches renderer version 2 and invalidates each material input', async () => fixture(async (dir, packageRoot, plan) => {
  const expected = hash({plan, contents: [hash(await renderCodeFingerprint(packageRoot)), hash(await readFile(path.join(dir, 'source.png'))), hash(await readFile(path.join(dir, 'voice.wav'))), hash(await readFile(path.join(dir, 'music.wav')))], version: 2});
  assert.equal(await currentRenderCacheKey(dir, plan, packageRoot), expected);
  await assertCurrentRender(dir, plan, {cacheKey: expected}, packageRoot);
  await assert.rejects(assertCurrentRender(dir, {...plan, title: 'Changed without changing duration'}, {cacheKey: expected}, packageRoot), /out of date/);
  for (const file of ['source.png', 'voice.wav', 'music.wav', 'toolkit/dist/render/Composition.js']) {
    const target = path.join(dir, file), original = await readFile(target);
    await writeFile(target, 'changed bytes');
    await assert.rejects(assertCurrentRender(dir, plan, {cacheKey: expected}, packageRoot), /out of date/);
    await writeFile(target, original);
  }
}));

test('preview approval is invalidated by replaced video, changed plan, changed source or unbound legacy report', async () => fixture(async (dir, packageRoot, plan) => {
  const file = path.join(dir, 'export.mp4');
  await writeFile(file, 'approved video bytes');
  const render = {file, cacheKey: await currentRenderCacheKey(dir, plan, packageRoot)};
  const saved = {schemaVersion: 1, runId: 'fixture', artifactSha256: hash(await readFile(file)), planSha256: hash(plan), status: 'degraded', deliveryStatus: 'reviewed', checks: [{name: 'editorial-motion', status: 'passed', method: 'normal-speed-playback', evidence: 'fixture'}], limitations: []};
  assert.equal((await previewQuality(dir, plan, render, saved, packageRoot)).report.deliveryStatus, 'reviewed');
  const candidate = async (currentPlan = plan, currentReport: unknown = saved) => {
    const quality = await previewQuality(dir, currentPlan, render, currentReport, packageRoot);
    assert.equal(quality.current, false);
    assert.equal(quality.report.deliveryStatus, 'review-candidate');
    assert.ok(quality.report.checks.every(check => check.status !== 'passed'));
  };
  await candidate({...plan, title: 'Same duration, different edit'});
  await candidate(plan, {...saved, artifactSha256: undefined, planSha256: undefined});
  await writeFile(file, 'new unreviewed video bytes'); await candidate();
  await writeFile(file, 'approved video bytes');
  await writeFile(path.join(dir, 'source.png'), 'source replaced after approval'); await candidate();
}));

test('inspect rejects an unbound render before attempting media probes or full decode', async () => fixture(async (dir, _packageRoot, plan) => {
  await writeJson(path.join(dir, 'edit-plan.json'), plan);
  await writeJson(path.join(dir, 'renders/render-test.json'), {file: path.join(dir, 'missing.mp4')});
  await assert.rejects(inspectRun(dir), /Render is out of date/);
}));
