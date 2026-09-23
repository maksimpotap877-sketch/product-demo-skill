import path from 'node:path';
import {readFile} from 'node:fs/promises';
import type {EditPlan} from './schema.js';
import {renderCodeFingerprint} from './rendering.js';
import {hash, PACKAGE_ROOT, readJson, safeFile} from './util.js';

/** Keep byte-compatible with renderReviewed's version-2 cache identity. */
export async function currentRenderCacheKey(runDir: string, plan: EditPlan, packageRoot = PACKAGE_ROOT) {
  const paths = [...new Set(plan.scenes.flatMap(scene => [scene.sourcePath, ...(scene.voicePath ? [scene.voicePath] : [])]).concat(plan.fullTrack ? [plan.fullTrack] : []))];
  const contents = [hash(await renderCodeFingerprint(packageRoot))];
  for (const file of paths) contents.push(hash(await readFile(await safeFile(runDir, file))));
  const config = await readJson(path.join(runDir, 'resolved-config.json'));
  if (config.musicFile) contents.push(hash(await readFile(path.resolve(config.project, config.musicFile))));
  return hash({plan, contents, version: 2});
}

export async function assertCurrentRender(runDir: string, plan: EditPlan, rendered: {cacheKey?: string}, packageRoot = PACKAGE_ROOT) {
  if (!rendered.cacheKey || rendered.cacheKey !== await currentRenderCacheKey(runDir, plan, packageRoot))
    throw new Error('Render is out of date for the current plan, source assets or renderer. Render again before inspection or approval.');
}
