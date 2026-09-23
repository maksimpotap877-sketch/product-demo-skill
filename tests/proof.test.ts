import test from 'node:test';
import assert from 'node:assert/strict';
import {selectProofScenes} from '../src/proof.js';
import type {EditPlan} from '../src/schema.js';

const fixture = {profile: {fps: 60}, scenes: [
  {sceneId: 'first', outputStartFrame: 0, outputDurationFrames: 120},
  {sceneId: 'second', outputStartFrame: 120, outputDurationFrames: 181},
  {sceneId: 'third', outputStartFrame: 301, outputDurationFrames: 60},
  {sceneId: 'fourth', outputStartFrame: 361, outputDurationFrames: 60},
  {sceneId: 'fifth', outputStartFrame: 421, outputDurationFrames: 60},
]} as EditPlan;

test('proof selection is explicit and bounded, with no default all-scenes render', () => {
  for (const ids of [[], ['first', 'first'], ['missing'], ['first', 'second', 'third', 'fourth', 'fifth']]) assert.throws(() => selectProofScenes(fixture, ids));
});

test('proof preserves exact parent timeline offsets and inclusive final frame', () => {
  const [second, first] = selectProofScenes(fixture, ['second', 'first']);
  assert.deepEqual(second.stillFrames, [120, 210, 300]);
  assert.equal(second.first, 120); assert.equal(second.last, 300);
  assert.equal(second.durationSec, 181 / 60);
  assert.deepEqual(first.stillFrames, [0, 59, 119]);
  assert.equal(first.durationSec, 2);
});
