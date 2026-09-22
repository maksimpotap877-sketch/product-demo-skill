import {copyFile, mkdir, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EditPlanSchema, type EditPlan} from './schema.js';
import {run, safeFile, writeJson} from './util.js';

/** Creates separate local 48 kHz voice/music stems and the unnormalized mix. */
export async function mixAudio(input: EditPlan, runDir: string, musicFile?: string) {
  const plan = EditPlanSchema.parse(input);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(plan.profile.name)) throw new Error('Unsafe audio profile name.');
  runDir = path.resolve(runDir);
  const durationSec = plan.durationFrames / plan.profile.fps;
  const directory = path.join(runDir, 'audio', plan.profile.name);
  await mkdir(directory, {recursive: true});
  const voicePath = path.join(directory, 'voice-48k.wav');
  const mixPath = path.join(directory, 'mix-48k.wav');
  const tracks = plan.fullTrack ? [{path: plan.fullTrack, startMs: 0, durationMs: plan.fullTrackDurationMs ?? durationSec * 1000}] : plan.scenes.filter(s => s.voicePath).map(s => ({path: s.voicePath!, startMs: s.outputStartFrame / plan.profile.fps * 1000 + 250, durationMs: s.voiceDurationMs}));
  if (!tracks.length) throw new Error('No narration audio in edit plan.');
  if (tracks.some(t => t.startMs + t.durationMs > durationSec * 1000 + 1)) throw new Error('Narration extends beyond the composition. Extend the plan before mixing.');
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const track of tracks) args.push('-i', await safeFile(runDir, track.path));
  const filters = tracks.map((track, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=in:d=0.015,afade=t=out:st=${Math.max(0, track.durationMs / 1000 - 0.02)}:d=0.02,adelay=${Math.round(track.startMs)}:all=1[v${i}]`);
  filters.push(tracks.map((_, i) => `[v${i}]`).join('') + `amix=inputs=${tracks.length}:normalize=0,apad,atrim=duration=${durationSec}[voice]`);
  await run('ffmpeg', [...args, '-filter_complex', filters.join(';'), '-map', '[voice]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', voicePath]);
  let musicPath: string | undefined;
  let musicSha256: string | undefined;
  if (musicFile) {
    if (/^[a-z]+:\/\//i.test(musicFile)) throw new Error('Music must be a local user-supplied file.');
    const original = await realpath(path.resolve(musicFile));
    const extension = path.extname(original).toLowerCase();
    if (!['.wav', '.mp3', '.flac', '.m4a', '.ogg'].includes(extension)) throw new Error('Unsupported local music audio extension.');
    musicSha256 = createHash('sha256').update(await readFile(original)).digest('hex');
    const stored = path.join(directory, `music-original-${musicSha256.slice(0, 12)}${extension}`);
    if (original !== stored) await copyFile(original, stored);
    const preparedMusic = path.join(directory, 'music-before-duck-48k.wav');
    musicPath = path.join(directory, 'music-ducked-48k.wav');
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-stream_loop', '-1', '-i', stored, '-t', String(durationSec), '-af', `aresample=48000,aformat=channel_layouts=stereo,volume=0.14,afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, durationSec - 0.75)}:d=0.75`, '-c:a', 'pcm_s24le', preparedMusic]);
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', preparedMusic, '-i', voicePath, '-filter_complex', '[0:a][1:a]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350:makeup=1[ducked]', '-map', '[ducked]', '-ar', '48000', '-c:a', 'pcm_s24le', musicPath]);
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', voicePath, '-i', musicPath, '-filter_complex', `[0:a][1:a]amix=inputs=2:normalize=0,atrim=duration=${durationSec}[mix]`, '-map', '[mix]', '-ar', '48000', '-c:a', 'pcm_s24le', mixPath]);
  } else await copyFile(voicePath, mixPath);
  const manifestPath = path.join(directory, 'audio-manifest.json');
  const relative = (file: string) => path.relative(runDir, file).split(path.sep).join('/');
  await writeJson(manifestPath, {schemaVersion: 1, runId: plan.runId, createdAt: new Date().toISOString(), profile: plan.profile.name, sampleRate: 48000, channels: 2, durationSec, voice: relative(voicePath), mix: relative(mixPath), ...(musicPath ? {music: relative(musicPath), musicSha256, musicProvenance: 'user-supplied local file; publication rights must be confirmed by owner', ducking: {method: 'ffmpeg sidechaincompress', threshold: 0.02, ratio: 8, attackMs: 15, releaseMs: 350}} : {music: null}), sfx: null, normalization: 'deferred to final two-pass loudness normalization; this mix is not the final AAC', resamplingNotice: '48 kHz mix does not imply 48 kHz source voice detail'});
  return {mixPath, voicePath, musicPath, manifestPath};
}
