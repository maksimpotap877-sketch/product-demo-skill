import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProgressFrames, progressEdge, type LayerFrameEvidence} from '../src/render-proof.js';

function frames(duplicateEvery = 1): LayerFrameEvidence[] {
  const width = 800, height = 4, fps = 144, durationFrames = 1200;
  const foreground = [100, 93, 231], background = [238, 240, 247];
  const results: LayerFrameEvidence[] = [];
  for (let i = 0; i < fps; i++) {
    const frame = 360 + i, expectedEdgePx = width * frame / durationFrames;
    const renderedFrame = Math.floor(frame / duplicateEvery) * duplicateEvery;
    const actualEdge = width * renderedFrame / durationFrames;
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const fill = Math.min(1, Math.max(0, actualEdge - x));
      for (let c = 0; c < 3; c++) rgb[(y * width + x) * 3 + c] = Math.round(foreground[c] * fill + background[c] * (1 - fill));
    }
    const edge = progressEdge(rgb, width, height, expectedEdgePx);
    results.push({frame, ptsMs: frame / fps * 1000, expectedEdgePx, measuredEdgePx: edge.edge, colorContrast: edge.contrast, cropSha256: `test-${i}`});
  }
  return results;
}
test('render proof accepts calibrated subpixel progression with 144 distinct states', () => {
  const proof = evaluateProgressFrames(frames(), 800 / 1200, 144);
  assert.equal(proof.status, 'passed');
});
test('render proof rejects duplicated 48fps states even with 144fps timestamps and different hashes', () => {
  const proof = evaluateProgressFrames(frames(3), 800 / 1200, 144);
  assert.equal(proof.status, 'degraded');
  assert.ok('observedFraction' in proof.metrics && proof.metrics.observedFraction! < 0.4);
});
test('render proof rejects low contrast and too few decoded frames', () => {
  assert.throws(() => progressEdge(new Uint8Array(800 * 4 * 3).fill(200), 800, 4, 300), /contrast/);
  assert.equal(evaluateProgressFrames(frames().slice(0, 5), 800 / 1200, 144).status, 'degraded');
});
