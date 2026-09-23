import path from 'node:path';
import os from 'node:os';
import {copyFile, mkdir, readFile, statfs} from 'node:fs/promises';
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {EditPlanSchema, type EditPlan} from './schema.js';
import {executeReviewedStage} from './execution.js';
import {mixAudio} from './audio.js';
import {validateRenderMedia} from './render-input.js';
import {renderCodeFingerprint, resolveRenderBrowser} from './rendering.js';
import {hash, PACKAGE_ROOT, probe, readJson, run, safeFile, writeJson} from './util.js';

export function selectProofScenes(plan: EditPlan, sceneIds: string[]) {
  if (!sceneIds.length || sceneIds.length > 4) throw new Error('Proof requires 1 to 4 explicit scene IDs.');
  if (new Set(sceneIds).size !== sceneIds.length) throw new Error('Proof scene IDs must not repeat.');
  return sceneIds.map(sceneId => {
    const scene = plan.scenes.find(item => item.sceneId === sceneId);
    if (!scene) throw new Error(`Unknown proof scene: ${sceneId}`);
    const first = scene.outputStartFrame, last = first + scene.outputDurationFrames - 1;
    return {scene, first, last, stillFrames: [...new Set([first, first + Math.floor((last - first) / 2), last])], durationSec: scene.outputDurationFrames / plan.profile.fps};
  });
}

/** Bounded proof from the parent run: same composition, inputs, analysis and render-attempt ledger. */
export async function proofRun(runDir: string, profile: string | undefined, sceneIds: string[]) {
  runDir = path.resolve(runDir);
  const config = await readJson(path.join(runDir, 'resolved-config.json'));
  const plan = EditPlanSchema.parse(await readJson(path.join(runDir, profile ? `edit-plan-${profile}.json` : 'edit-plan.json')));
  const selected = selectProofScenes(plan, sceneIds);
  const renderer = await renderCodeFingerprint();
  const proofImplementationSha256 = hash(await readFile(path.join(PACKAGE_ROOT, 'dist/proof.js')));
  const purpose = 'proof';
  return executeReviewedStage({config, runDir, stage: 'render', inputs: {purpose, profile, plan, sceneIds, renderer, proofImplementationSha256}, execute: async review => {
    const preflight = await validateRenderMedia(runDir, plan);
    const relative = (file: string) => path.relative(runDir, file).split(path.sep).join('/');
    const stage = path.join(runDir, '.proof-assets');
    await mkdir(stage, {recursive: true});
    const paths = [...new Set(plan.scenes.flatMap(scene => [scene.sourcePath, ...(scene.voicePath ? [scene.voicePath] : [])]).concat(plan.fullTrack ? [plan.fullTrack] : []))];
    const assets = [];
    for (const item of paths) {
      if (path.isAbsolute(item) || item.split(/[\\/]/).includes('..')) throw new Error('Proof asset paths must be relative to the parent run.');
      const source = await safeFile(runDir, item), destination = path.join(stage, item);
      await mkdir(path.dirname(destination), {recursive: true}); await copyFile(source, destination);
      assets.push({path: item, sha256: hash(await readFile(source))});
    }
    const musicFile = config.musicFile ? path.resolve(config.project ?? runDir, config.musicFile) : undefined;
    const musicSha256 = musicFile ? hash(await readFile(musicFile)) : null;
    const fingerprint = hash({purpose, plan, renderer, proofImplementationSha256, assets, sceneIds, musicSha256});
    const directory = path.join(runDir, 'review', `proof-${plan.profile.name}`, fingerprint.slice(0, 16));
    const reportPath = path.join(directory, 'proof.json');
    try {
      const previous = await readJson(reportPath);
      if (previous.fingerprint === fingerprint && Array.isArray(previous.artifacts) && previous.artifacts.length) {
        const current = await Promise.all(previous.artifacts.map(async (item: {path: string; sha256: string}) => hash(await readFile(await safeFile(runDir, item.path))) === item.sha256));
        if (current.every(Boolean)) return {...previous, reportPath, cacheHit: true};
      }
    } catch {}
    const selectedFrames = selected.reduce((sum, item) => sum + item.scene.outputDurationFrames, 0);
    const disk = await statfs(runDir), estimatedBytes = Math.max(500_000_000, plan.profile.width * plan.profile.height * selectedFrames / 6);
    if (disk.bavail * disk.bsize < estimatedBytes || os.freemem() < 2e9) throw new Error('Insufficient free disk/RAM for selected proof scenes.');
    await mkdir(directory, {recursive: true});
    const hasNarration = !!plan.fullTrack || plan.scenes.some(scene => scene.voicePath);
    const audio = hasNarration ? await mixAudio(plan, runDir, musicFile) : null;
    const serveUrl = await bundle({entryPoint: path.join(PACKAGE_ROOT, 'dist/render/index.js'), publicDir: stage, onProgress: () => undefined});
    const browser = await resolveRenderBrowser(), inputProps = {plan};
    const composition = await selectComposition({serveUrl, id: 'ProductDemo', inputProps, ...browser, logLevel: 'error'});
    const artifacts: {type: 'still' | 'video'; sceneId: string; path: string; sha256: string; frame?: number; frameRange?: [number, number]; durationSec?: number}[] = [];
    const measurements = [];
    for (let index = 0; index < selected.length; index++) {
      const item = selected[index], prefix = `scene-${index + 1}`;
      for (const frame of item.stillFrames) {
        const output = path.join(directory, `${prefix}-frame-${frame}.png`);
        await renderStill({serveUrl, composition, inputProps, frame, output, imageFormat: 'png', ...browser, logLevel: 'error'});
        artifacts.push({type: 'still', sceneId: item.scene.sceneId, path: relative(output), frame, sha256: hash(await readFile(output))});
      }
      const raw = path.join(directory, `${prefix}-raw.mp4`), video = path.join(directory, `${prefix}-proof.mp4`);
      await renderMedia({serveUrl, composition, inputProps, outputLocation: raw, frameRange: [item.first, item.last], codec: 'h264', crf: 17, pixelFormat: 'yuv420p', x264Preset: 'fast', imageFormat: 'jpeg', jpegQuality: 95, concurrency: 4, ...browser, logLevel: 'error', muted: true});
      if (audio) {
        await run('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-ss', String(item.first / plan.profile.fps), '-i', audio.mixPath, '-map', '0:v:0', '-map', '1:a:0', '-t', String(item.durationSec), '-c:v', 'copy', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', video], {timeoutMs: 300000});
      } else await copyFile(raw, video);
      await run('ffmpeg', ['-v', 'error', '-xerror', '-i', video, '-f', 'null', '-'], {timeoutMs: 300000});
      const media = await probe(video), stream = media.streams.find((value: any) => value.codec_type === 'video');
      const duration = Number(media.format.duration);
      const rate = String(stream.avg_frame_rate).split('/').map(Number), measuredFps = rate[0] / rate[1];
      if (stream.width !== plan.profile.width || stream.height !== plan.profile.height || Math.abs(duration - item.durationSec) > .15 || Math.abs(measuredFps - plan.profile.fps) > .001 || Number(stream.nb_frames) !== item.scene.outputDurationFrames) throw new Error(`Proof output geometry/duration/frame count mismatch: ${item.scene.sceneId}`);
      artifacts.push({type: 'video', sceneId: item.scene.sceneId, path: relative(video), frameRange: [item.first, item.last], durationSec: item.durationSec, sha256: hash(await readFile(video))});
      measurements.push({sceneId: item.scene.sceneId, width: stream.width, height: stream.height, durationSec: duration, frames: Number(stream.nb_frames), fps: measuredFps, decoded: true, audio: audio ? 'existing mix trimmed at parent timeline offset' : 'not-present'});
    }
    const result = {schemaVersion: 1, purpose, parentRun: plan.runId, fingerprint, parentPlanSha256: hash(plan), analysisHash: review.analysisHash, renderer, proofImplementationSha256, assets, musicSha256, createdAt: new Date().toISOString(), profile: plan.profile, selectedScenes: selected.map(item => ({sceneId: item.scene.sceneId, frameRange: [item.first, item.last], durationSec: item.durationSec})), artifacts, measurements, preflight, technicalStatus: 'passed', deliveryStatus: 'review-candidate', subjectiveMotion: 'not-tested', subjectiveListening: 'not-tested', audioNote: audio ? 'Same existing narration/music mix, exact parent timing; full-export loudness normalization is not applied to proof excerpts.' : 'No existing narration; proof is silent.', capture: 'reused', synthesis: 'not-run', cacheHit: false};
    await writeJson(reportPath, result);
    await writeJson(path.join(runDir, 'review', `proof-${plan.profile.name}-latest.json`), {report: relative(reportPath), fingerprint});
    return {...result, reportPath};
  }});
}
