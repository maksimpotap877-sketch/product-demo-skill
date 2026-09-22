import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoConfigSchema, EditPlanSchema, profiles, RenderProfileSchema} from '../src/schema.js';
import {makeExampleConfig} from '../src/discovery.js';

test('config rejects credential URLs, secret query/fragment tokens and recorded sensitive fields', () => {
  const c = makeExampleConfig(process.cwd());
  for (const url of ['file:///C:/private.txt', 'javascript:alert(1)', 'https://user:password@example.test/', 'https://example.test/?access_token=fixture', 'https://example.test/?api_key=fixture', 'https://example.test/#access_token=fixture']) {
    assert.equal(DemoConfigSchema.safeParse({...c, url}).success, false, url);
  }
  for (const locator of [{label: 'Пароль'}, {css: '#password'}, {label: 'Credit card'}, {label: 'API key'}]) {
    assert.equal(DemoConfigSchema.safeParse({...c, actions: [{type: 'fill', locator, value: 'NOT_A_REAL_SECRET'}]}).success, false);
  }
  assert.ok(DemoConfigSchema.safeParse({...c, url: 'https://example.test/projects?tab=demo', actions: [{type: 'fill', locator: {label: 'Название проекта'}, value: 'Открытый demo-проект'}]}).success);
});

test('data schemas reject executable keys and shell-like server configuration', () => {
  const c = makeExampleConfig(process.cwd());
  for (const extra of [{eval: 'process.exit()'}, {shell: 'cmd'}, {imports: ['malicious']}]) assert.equal(DemoConfigSchema.safeParse({...c, ...extra}).success, false);
  assert.equal(DemoConfigSchema.safeParse({...c, start: {command: 'node', args: [], shell: true}}).success, false);
  assert.equal(DemoConfigSchema.safeParse({...c, start: {command: 'node', args: 'server.js'}}).success, false);
});

test('render profile names cannot escape artifact directories and H264 geometry is valid', () => {
  for (const name of ['../../escape', 'x/../../../escape', 'C:\\outside', '..', 'web\\escape']) {
    assert.equal(RenderProfileSchema.safeParse({...profiles['web-60'], name}).success, false, name);
  }
  assert.equal(RenderProfileSchema.safeParse({...profiles['web-60'], width: 1919}).success, false);
  assert.ok(RenderProfileSchema.safeParse(profiles['master-144']).success);
});

test('edit plan rejects unknown executable payload and voice beyond the composition', () => {
  const scene = {sceneId: 'a', kind: 'screenshot', sourcePath: 'capture/a.png', sourceStartMs: 0, sourceEndMs: 1000, sourceDurationMs: 1000, outputStartFrame: 0, outputDurationFrames: 60, playbackRate: 1, voiceDurationMs: 500, title: 'Тест', caption: 'Тест', camera: [{frame: 0, scale: 1, x: 0.5, y: 0.5}], events: []};
  const p = {schemaVersion: 1, runId: 'test', toolVersion: '0.1.0', profile: profiles['web-60'], durationFrames: 60, transitionFrames: 0, title: 'Тест', accent: '#6655ff', viewportCss: {width: 1600, height: 900}, sourcePixels: {width: 2560, height: 1440}, scenes: [scene], provenance: []};
  assert.ok(EditPlanSchema.safeParse(p).success);
  assert.equal(EditPlanSchema.safeParse({...p, execute: 'node malicious.js'}).success, false);
  assert.equal(EditPlanSchema.safeParse({...p, scenes: [{...scene, voiceDurationMs: 900}]}).success, false);
  assert.equal(EditPlanSchema.safeParse({...p, fullTrack: 'narration/imported.wav', fullTrackDurationMs: 1200}).success, false);
});
