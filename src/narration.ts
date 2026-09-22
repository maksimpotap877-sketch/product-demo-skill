import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {copyFile, mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export type VoiceGender = 'female' | 'male';
export interface LocalVoice {id: string; name: string; gender: string; language: string; description: string; engineVersion: string}
export interface NarrationOptions {
  voice?: VoiceGender; voiceId?: string; language?: string; provider?: string;
  narrationFile?: string; rate?: number; pronunciations?: Record<string, string>;
  cacheDir?: string; dryRun?: boolean; savePreference?: boolean;
  allowExternalTts?: boolean; speechRatePercent?: number;
}
export interface NarrationSegment {
  sceneId: string; path: string; durationMs: number; sha256: string;
  alignment: 'segment' | 'none'; cacheHit: boolean; sampleRate: number; channels: number;
  spokenText?: string; maxVolumeDb: number; meanVolumeDb: number; fullDecode: 'passed';
}
export interface NarrationManifest {
  schemaVersion: 1; runId: string; createdAt: string; provider: string; voiceId: string;
  language: string; voice: string; segments: NarrationSegment[]; fullTrack?: NarrationSegment;
  cost: {amount: number; currency: 'USD'; externalRequests: number; estimated: boolean};
  status: 'passed'; alignment: 'segment' | 'none'; subjectiveListening: 'not-tested';
  synthetic: boolean; disclosure: string; sourceHash: string;
  settings: Record<string, unknown>; semanticSync?: string;
}
const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const dataRoot = process.env.PRODUCT_DEMO_DATA_DIR ? path.resolve(process.env.PRODUCT_DEMO_DATA_DIR) : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'product-demo-toolkit');
const defaultCacheDir = path.join(dataRoot, 'cache', 'narration');
const preferencesFile = path.join(dataRoot, 'narration-preferences.json');
const EDGE_VERSION = '7.2.8';
const edgeEnvironment = path.join(dataRoot, 'python', `edge-neural-${EDGE_VERSION}`);
const edgePython = path.join(edgeEnvironment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const edgeCatalogFile = path.join(dataRoot, 'tts', 'edge-neural-voices.json');
const EDGE_REQUIREMENTS = ['edge-tts==7.2.8', 'aiohappyeyeballs==2.7.1', 'aiohttp==3.14.3', 'aiosignal==1.4.0', 'attrs==26.1.0', 'certifi==2026.7.22', 'frozenlist==1.8.0', 'idna==3.20', 'multidict==6.9.1', 'propcache==0.5.4', 'tabulate==0.10.0', 'typing-extensions==4.16.0', 'yarl==1.25.1'];

export async function setupNeuralProvider() {
  let ready = false;
  if (await exists(edgePython)) {
    try {const installed = JSON.parse((await runProcess(edgePython, [path.join(scriptsDir, 'tts-edge-neural.py'), '--action', 'version'])).stdout); ready = installed.version === EDGE_VERSION;} catch {}
  }
  if (!ready) {
    if (!await exists(edgePython)) {
      const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
      let created = false;
      for (const candidate of candidates) {
        try {await runProcess(candidate, ['-m', 'venv', edgeEnvironment], undefined, 120_000); created = true; break;} catch {}
      }
      if (!created) throw new Error('Neural TTS setup needs Python 3.10+ with venv in PATH. Install Python from python.org, then repeat setup. No system policy was changed.');
    }
    await runProcess(edgePython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', ...EDGE_REQUIREMENTS], undefined, 180_000);
  }
  await writeJson(path.join(dataRoot, 'tts', 'edge-neural-install.json'), {schemaVersion: 1, provider: 'edge-neural', client: 'edge-tts', clientVersion: EDGE_VERSION, python: edgePython, requirements: EDGE_REQUIREMENTS, source: 'https://pypi.org/project/edge-tts/7.2.8/', installedAt: new Date().toISOString(), service: 'Microsoft Edge online speech; unofficial third-party client', chargedAmountUSD: 0});
  return {status: 'passed', provider: 'edge-neural', clientVersion: EDGE_VERSION, python: edgePython, reused: ready};
}

async function listNeuralVoices(language = 'ru-RU'): Promise<LocalVoice[]> {
  await setupNeuralProvider();
  let catalog: {fetchedAt: string; voices: any[]} | undefined;
  try {const saved = JSON.parse(await readFile(edgeCatalogFile, 'utf8')); if (Date.now() - Date.parse(saved.fetchedAt) < 24 * 3600_000) catalog = saved;} catch {}
  if (!catalog) {
    const response = JSON.parse((await runProcess(edgePython, [path.join(scriptsDir, 'tts-edge-neural.py'), '--action', 'voices'], undefined, 45_000)).stdout);
    catalog = {fetchedAt: new Date().toISOString(), voices: response.voices};
    await writeJson(edgeCatalogFile, catalog);
  }
  return catalog.voices.filter(v => v.Locale === language && ['ru-RU-SvetlanaNeural', 'ru-RU-DmitryNeural'].includes(v.ShortName)).sort((a, b) => a.ShortName === 'ru-RU-SvetlanaNeural' ? -1 : b.ShortName === 'ru-RU-SvetlanaNeural' ? 1 : 0).map(v => ({id: v.ShortName, name: v.FriendlyName, gender: v.Gender.toLowerCase(), language: v.Locale, description: v.Name, engineVersion: `edge-tts-${EDGE_VERSION};remote-model-unversioned`}));
}

export function resolveNarrationProvider(provider = 'auto', allowExternalTts = false): 'edge-neural' | 'windows-sapi' {
  if (provider === 'windows-sapi') return provider;
  if (!['auto', 'edge-neural'].includes(provider)) throw new Error(`TTS provider ${provider} is not implemented.`);
  if (!allowExternalTts) throw new Error('Natural neural narration sends spokenText to Microsoft Edge speech. Add --allow-external-tts after authorizing those texts, or explicitly choose --tts-provider windows-sapi for the older offline voice. No voice was substituted.');
  return 'edge-neural';
}

async function runProcess(command: string, args: string[], input?: string, timeout = 120_000): Promise<{stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {proc.kill(); reject(new Error(`${path.basename(command)} timed out`));}, timeout);
    proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (s: string) => {stdout += s; if (stdout.length > 2_000_000) proc.kill();});
    proc.stderr.on('data', (s: string) => {stderr += s; if (stderr.length > 2_000_000) proc.kill();});
    proc.once('error', (e) => {clearTimeout(timer); reject(e);});
    proc.once('close', (code) => {clearTimeout(timer); code === 0 ? resolve({stdout, stderr}) : reject(new Error(`${path.basename(command)} failed (exit ${code}); ${stderr.slice(0, 600)}`));});
    proc.stdin.on('error', () => {}); proc.stdin.end(input ?? '');
  });
}
let shellPath: string | undefined;
async function runSapi(action: 'voices' | 'synthesize', input?: object): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Windows SAPI is available only on Windows. Import a local WAV/MP3 with --narration-file on this platform.');
  const candidates = shellPath ? [shellPath] : ['pwsh.exe', 'powershell.exe'];
  const failures: string[] = [];
  for (const command of candidates) {
    try {
      const result = await runProcess(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(scriptsDir, 'tts-windows.ps1'), '-Action', action], input ? JSON.stringify(input) : undefined);
      shellPath = command;
      return result.stdout.trim().replace(/^\uFEFF/, '');
    } catch (error) {failures.push(error instanceof Error ? error.message : String(error));}
  }
  throw new Error(`Windows TTS unavailable. Install Russian voices using Windows Settings > Time & language > Speech, or use --narration-file. Script execution policy was not changed. ${failures.join(' | ')}`);
}

export async function listNarrationVoices(language = 'ru-RU', provider: 'windows-sapi' | 'edge-neural' = 'windows-sapi'): Promise<LocalVoice[]> {
  if (provider === 'edge-neural') return listNeuralVoices(language);
  const raw = JSON.parse(await runSapi('voices')) as LocalVoice[] | LocalVoice;
  return (Array.isArray(raw) ? raw : [raw]).filter(v => v.language.toLowerCase() === language.toLowerCase());
}
export function selectVoice(voices: LocalVoice[], gender: VoiceGender, voiceId?: string): LocalVoice {
  const match = voiceId ? voices.find(v => v.id === voiceId) : voices.find(v => v.gender === gender);
  if (!match) throw new Error(`Requested ${gender} Russian voice ${voiceId ?? ''} is unavailable; the selected gender is never silently substituted.`);
  if (match.gender !== gender) throw new Error(`Voice ${match.id} is catalogued as ${match.gender}, which conflicts with --voice ${gender}.`);
  return match;
}
export async function narrationStatus() {
  try {
    const voices = await listNarrationVoices();
    const both = ['female', 'male'].every(g => voices.some(v => v.gender === g));
    let neuralVoices: unknown[] = []; try {neuralVoices = JSON.parse(await readFile(edgeCatalogFile, 'utf8')).voices;} catch {}
    const neuralReady = await exists(edgePython) && neuralVoices.length > 0;
    return {provider: 'edge-neural', status: neuralReady ? 'passed' : 'blocked', preferredProvider: 'edge-neural', neural: {installed: await exists(edgePython), clientVersion: EDGE_VERSION, voices: neuralVoices, textTransmissionRequiresConsent: true, liveServiceAvailability: 'not-tested-by-doctor', fallback: 'disabled'}, offlineLegacy: {provider: 'windows-sapi', status: both ? 'passed' : 'blocked', voices}, capabilities: {local: false, russian: neuralReady, segmentAlignment: true, wordAlignment: false, cloning: false, wavImport: true, mp3Import: true}, subjectiveListening: 'not-tested', dataRoot, shell: shellPath};
  } catch (error) {return {provider: 'windows-sapi', status: 'blocked', reason: error instanceof Error ? error.message : String(error), capabilities: {wavImport: true, mp3Import: true}};}
}
export async function setupNarration() {return narrationStatus();}
export function estimateNarrationCost(text: string) {return {characters: [...text].length, amount: 0, currency: 'USD' as const, externalRequests: 0, estimated: false, reason: 'Installed local Windows speech engine; no network synthesis API'};}

export function normalizeSpokenText(text: string, pronunciations: Record<string, string> = {}): string {
  let result = text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  for (const [term, pronunciation] of Object.entries(pronunciations).sort(([a], [b]) => b.length - a.length)) {
    if (term) result = result.split(term).join(pronunciation);
  }
  if (!result) throw new Error('Narration text must not be empty.');
  if (result.length > 5000) throw new Error('Narration segment is too long (maximum 5000 characters).');
  return result;
}
export function narrationCacheKey(text: string, voice: Pick<LocalVoice, 'id' | 'engineVersion'>, rate: number, pronunciations: Record<string, string> = {}, provider = 'windows-sapi'): string {
  return createHash('sha256').update(JSON.stringify({schemaVersion: 2, provider, text: normalizeSpokenText(text, pronunciations), voiceId: voice.id, engineVersion: voice.engineVersion, rate, volume: 100, pronunciations: Object.entries(pronunciations).sort(([a], [b]) => a.localeCompare(b))})).digest('hex');
}
async function hashFile(filename: string) {return createHash('sha256').update(await readFile(filename)).digest('hex');}
async function exists(filename: string) {try {await stat(filename); return true;} catch {return false;}}
async function writeJson(filename: string, data: unknown) {await mkdir(path.dirname(filename), {recursive: true}); await writeFile(filename, JSON.stringify(data, null, 2) + '\n', 'utf8');}
export async function inspectNarrationAudio(filename: string) {
  const result = await runProcess('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels,duration:format=duration', '-of', 'json', filename]);
  const media = JSON.parse(result.stdout);
  const stream = media.streams?.[0];
  const durationMs = Number(stream?.duration ?? media.format?.duration) * 1000;
  if (!stream || !Number.isFinite(durationMs) || durationMs < 100) throw new Error('Narration file is empty, too short or has no audio stream.');
  const decode = await runProcess('ffmpeg', ['-hide_banner', '-v', 'info', '-xerror', '-i', filename, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-']);
  const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(decode.stderr);
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(decode.stderr);
  const maxVolumeDb = peak ? Number(peak[1]) : -Infinity;
  const meanVolumeDb = mean ? Number(mean[1]) : -Infinity;
  if (!Number.isFinite(maxVolumeDb) || maxVolumeDb < -60) throw new Error('Narration file contains no measurable speech-level signal.');
  return {durationMs, sampleRate: Number(stream.sample_rate), channels: Number(stream.channels), maxVolumeDb, meanVolumeDb, fullDecode: 'passed' as const};
}
async function synthesizeCached(text: string, voice: LocalVoice, rate: number, pronunciations: Record<string, string>, cacheDir: string) {
  const key = narrationCacheKey(text, voice, rate, pronunciations);
  const wav = path.join(cacheDir, `${key}.wav`), metadata = path.join(cacheDir, `${key}.json`);
  await mkdir(cacheDir, {recursive: true});
  if (await exists(wav) && await exists(metadata)) {
    try {
      const saved = JSON.parse(await readFile(metadata, 'utf8'));
      const audio = saved.audio;
      const valid = audio && Number.isFinite(audio.durationMs) && audio.durationMs >= 100 && Number.isInteger(audio.sampleRate) && audio.sampleRate > 0 && Number.isInteger(audio.channels) && audio.channels > 0 && Number.isFinite(audio.maxVolumeDb) && Number.isFinite(audio.meanVolumeDb) && audio.fullDecode === 'passed';
      if (valid && saved.key === key && saved.sha256 === await hashFile(wav)) return {wav, durationMs: audio.durationMs as number, sampleRate: audio.sampleRate as number, channels: audio.channels as number, maxVolumeDb: audio.maxVolumeDb as number, meanVolumeDb: audio.meanVolumeDb as number, fullDecode: 'passed' as const, sha256: saved.sha256 as string, cacheHit: true};
    } catch {/* Corrupt/incomplete cache is regenerated, not trusted. */}
  }
  const temporary = path.join(cacheDir, `${key}.${randomUUID()}.wav`);
  try {
    await runSapi('synthesize', {voiceId: voice.id, text: normalizeSpokenText(text, pronunciations), rate, outputPath: temporary});
    const audio = await inspectNarrationAudio(temporary);
    const sha256 = await hashFile(temporary);
    await rm(wav, {force: true}); await rename(temporary, wav);
    await writeJson(metadata, {key, sha256, audio, provider: 'windows-sapi', voiceId: voice.id});
    return {wav, ...audio, sha256, cacheHit: false};
  } finally {await rm(temporary, {force: true});}
}
async function synthesizeNeuralCached(text: string, voice: LocalVoice, speechRatePercent: number, pronunciations: Record<string, string>, cacheDir: string) {
  const key = narrationCacheKey(text, voice, speechRatePercent, pronunciations, 'edge-neural');
  const wav = path.join(cacheDir, `${key}.mp3`), metadata = path.join(cacheDir, `${key}.json`);
  await mkdir(cacheDir, {recursive: true});
  if (await exists(wav) && await exists(metadata)) {
    try {
      const saved = JSON.parse(await readFile(metadata, 'utf8'));
      if (saved.key === key && saved.sha256 === await hashFile(wav)) {
        const audio = await inspectNarrationAudio(wav);
        return {wav, ...audio, sha256: saved.sha256 as string, cacheHit: true, providerMarks: saved.providerMarks, synthesisRequests: 0};
      }
    } catch {/* Corrupt or truncated cache is regenerated. */}
  }
  const temporary = path.join(cacheDir, `${key}.${randomUUID()}.mp3`);
  try {
    let response: any; let synthesisRequests = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      synthesisRequests++;
      try {
        response = JSON.parse((await runProcess(edgePython, [path.join(scriptsDir, 'tts-edge-neural.py'), '--action', 'synthesize'], JSON.stringify({voiceId: voice.id, text: normalizeSpokenText(text, pronunciations), speechRatePercent, outputPath: temporary, allowExternalTts: true}), 70_000)).stdout);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt > 0 || !/NoAudioReceived|TimeoutError|ConnectionResetError|ServerDisconnectedError/.test(message)) throw error;
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }
    const audio = await inspectNarrationAudio(temporary);
    const sha256 = await hashFile(temporary);
    await rm(wav, {force: true}); await rename(temporary, wav);
    await writeJson(metadata, {key, sha256, audio, provider: 'edge-neural', voiceId: voice.id, providerMarks: response.providerMarks, remoteModelVersion: 'unavailable', synthesisRequests});
    return {wav, ...audio, sha256, cacheHit: false, providerMarks: response.providerMarks, synthesisRequests};
  } finally {await rm(temporary, {force: true});}
}
interface StoryScene {sceneId: string; spokenText: string; displayText?: string; pronunciations?: Record<string, string>}
function readScenes(value: unknown): StoryScene[] {
  const storyboard = value as {scenes?: StoryScene[]};
  if (!Array.isArray(storyboard.scenes) || !storyboard.scenes.length) throw new Error('storyboard.json must have at least one scene.');
  const seen = new Set<string>();
  for (const scene of storyboard.scenes) {
    if (!scene || typeof scene.sceneId !== 'string' || !/^[\p{L}\p{N}_-]+$/u.test(scene.sceneId) || seen.has(scene.sceneId)) throw new Error('Each sceneId must be unique and contain only letters, digits, underscore or dash.');
    if (typeof scene.spokenText !== 'string') throw new Error(`Scene ${scene.sceneId} has no spokenText.`);
    seen.add(scene.sceneId);
  }
  return storyboard.scenes;
}
export async function readPreferences(): Promise<{voice?: VoiceGender}> {try {const value = JSON.parse(await readFile(preferencesFile, 'utf8')); return ['female', 'male'].includes(value.voice) ? {voice: value.voice} : {};} catch {return {};}}
function relative(runDir: string, filename: string) {return path.relative(runDir, filename).split(path.sep).join('/');}

export async function narrate(runDir: string, options: NarrationOptions = {}): Promise<NarrationManifest> {
  runDir = path.resolve(runDir);
  const storyboardText = await readFile(path.join(runDir, 'storyboard.json'), 'utf8');
  const scenes = readScenes(JSON.parse(storyboardText));
  const language = options.language ?? 'ru-RU';
  const preferences = await readPreferences();
  const gender = options.voice ?? preferences.voice ?? 'female';
  const rate = options.rate ?? 0;
  const speechRatePercent = options.speechRatePercent ?? 0;
  if (!Number.isInteger(rate) || rate < -2 || rate > 2) throw new Error('Narration rate must be an integer between -2 and 2 (default 0).');
  if (!Number.isInteger(speechRatePercent) || Math.abs(speechRatePercent) > 10) throw new Error('Neural speech rate must be an integer from -10 to 10 percent.');
  const provider = options.narrationFile ? 'local-import' : resolveNarrationProvider(options.provider, options.allowExternalTts);
  if (options.dryRun) throw new Error('Dry run must be handled by the CLI; narrate does not write partial placeholder manifests.');
  const segmentsDir = path.join(runDir, 'narration', 'segments');
  await mkdir(segmentsDir, {recursive: true});
  const manifest: NarrationManifest = {
    schemaVersion: 1, runId: path.basename(runDir), createdAt: new Date().toISOString(), provider, voiceId: 'user-recording', language, voice: gender, segments: [], cost: {amount: 0, currency: 'USD', externalRequests: 0, estimated: false}, status: 'passed', alignment: 'segment', subjectiveListening: 'not-tested', synthetic: !options.narrationFile, disclosure: options.narrationFile ? 'Пользовательская запись.' : provider === 'edge-neural' ? 'Озвучка создана нейросетевым голосом Microsoft Svetlana/Dmitry через онлайн-сервис Edge.' : 'Озвучка создана синтетическим голосом Windows.', sourceHash: createHash('sha256').update(storyboardText).digest('hex'), settings: {rate, speechRatePercent, volume: 100, pronunciations: options.pronunciations ?? {}, ...(provider === 'edge-neural' ? {externalTextTransmissionAuthorized: true, externalTextDestination: 'Microsoft Edge online speech', client: `edge-tts ${EDGE_VERSION}`, costExplanation: 'Consumer speech service without metered API/key; no payment request made', commercialPublicationRights: 'not-verified', fallback: 'disabled'} : {})}
  };
  if (options.narrationFile) {
    const imported = path.resolve(options.narrationFile);
    const extension = path.extname(imported).toLowerCase();
    if (!['.wav', '.mp3'].includes(extension)) throw new Error('Narration import supports WAV and MP3 files.');
    const audio = await inspectNarrationAudio(imported);
    const original = path.join(runDir, 'narration', `imported-original${extension}`);
    if (path.resolve(original) !== imported) await copyFile(imported, original);
    const sha256 = await hashFile(original);
    const sidecar = `${imported}.segments.json`;
    if (await exists(sidecar)) {
      const mapping: {sceneId: string; startMs: number; endMs: number}[] = JSON.parse(await readFile(sidecar, 'utf8'));
      if (!Array.isArray(mapping) || mapping.length !== scenes.length) throw new Error('Import sidecar must map every storyboard scene exactly once.');
      const mapped = new Set<string>();
      for (const range of mapping) {
        if (!scenes.some(s => s.sceneId === range.sceneId) || mapped.has(range.sceneId) || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) || range.startMs < 0 || range.endMs <= range.startMs || range.endMs > audio.durationMs + 1) throw new Error('Invalid or duplicate import segment range.');
        mapped.add(range.sceneId);
        const output = path.join(segmentsDir, `${range.sceneId}.wav`);
        await runProcess('ffmpeg', ['-y', '-v', 'error', '-i', original, '-af', `atrim=start=${range.startMs / 1000}:end=${range.endMs / 1000},asetpts=PTS-STARTPTS`, '-c:a', 'pcm_s16le', output]);
        manifest.segments.push({sceneId: range.sceneId, path: relative(runDir, output), ...await inspectNarrationAudio(output), sha256: await hashFile(output), alignment: 'segment', cacheHit: false});
      }
      manifest.settings.importMapping = mapping;
    } else if (scenes.length === 1) {
      manifest.segments.push({sceneId: scenes[0].sceneId, path: relative(runDir, original), ...audio, sha256, alignment: 'segment', cacheHit: false});
    } else {
      manifest.alignment = 'none';
      manifest.fullTrack = {sceneId: '__full_narration__', path: relative(runDir, original), ...audio, sha256, alignment: 'none', cacheHit: false};
      manifest.semanticSync = 'not-tested: continuous user recording, no per-scene timing map supplied';
    }
  } else {
    const voices = await listNarrationVoices(language, provider as 'windows-sapi' | 'edge-neural');
    const voice = selectVoice(voices, gender, options.voiceId);
    manifest.voiceId = voice.id;
    manifest.settings.voiceName = voice.name; manifest.settings.engineVersion = voice.engineVersion;
    for (const scene of scenes) {
      const pronunciations = {...options.pronunciations, ...scene.pronunciations};
      const spokenText = normalizeSpokenText(scene.spokenText, pronunciations);
      const result = provider === 'edge-neural' ? await synthesizeNeuralCached(scene.spokenText, voice, speechRatePercent, pronunciations, options.cacheDir ?? defaultCacheDir) : await synthesizeCached(scene.spokenText, voice, rate, pronunciations, options.cacheDir ?? defaultCacheDir);
      const output = path.join(segmentsDir, `${scene.sceneId}-${result.sha256.slice(0, 12)}${path.extname(result.wav)}`);
      await copyFile(result.wav, output);
      const {wav: _wav, ...metadata} = result;
      manifest.segments.push({sceneId: scene.sceneId, path: relative(runDir, output), alignment: 'segment', spokenText, ...metadata});
      if (provider === 'edge-neural' && 'synthesisRequests' in result) manifest.cost.externalRequests += Number(result.synthesisRequests);
    }
    if (options.voice && options.savePreference !== false) await writeJson(preferencesFile, {voice: options.voice});
  }
  await writeJson(path.join(runDir, 'narration', 'narration-manifest.json'), manifest);
  return manifest;
}

export const VOICE_SAMPLE_TEXT = 'Демо Консоль помогает собрать работу в одном месте. Создадим проект за три шага. Откройте панель управления и нажмите «Новый проект». Всё готово: результат уже на экране.';
export async function voicesPreview(outputDir: string, options: {language?: string; cacheDir?: string; provider?: string; allowExternalTts?: boolean; speechRatePercent?: number; voice?: VoiceGender} = {}) {
  const provider = resolveNarrationProvider(options.provider, options.allowExternalTts);
  const speechRatePercent = options.speechRatePercent ?? 0;
  if (!Number.isInteger(speechRatePercent) || Math.abs(speechRatePercent) > 10) throw new Error('Neural speech rate must be an integer from -10 to 10 percent.');
  outputDir = path.resolve(outputDir); await mkdir(outputDir, {recursive: true});
  const language = options.language ?? 'ru-RU';
  const voices = await listNarrationVoices(language, provider);
  const samples: Record<string, unknown>[] = [];
  for (const gender of options.voice ? [options.voice] : ['female', 'male'] as const) {
    const voice = selectVoice(voices, gender);
    const result = provider === 'edge-neural' ? await synthesizeNeuralCached(VOICE_SAMPLE_TEXT, voice, speechRatePercent, {}, options.cacheDir ?? defaultCacheDir) : await synthesizeCached(VOICE_SAMPLE_TEXT, voice, 0, {}, options.cacheDir ?? defaultCacheDir);
    const output = path.join(outputDir, `${gender}-ru${path.extname(result.wav)}`); await copyFile(result.wav, output);
    const {wav: _wav, ...audio} = result;
    samples.push({gender, voiceId: voice.id, voiceName: voice.name, path: output, speechRatePercent, ...audio, subjectiveListening: 'not-tested', genderEvidence: provider === 'edge-neural' ? 'live service catalogue metadata' : 'installed provider voice metadata'});
  }
  const result = {schemaVersion: 1, createdAt: new Date().toISOString(), provider, language, text: VOICE_SAMPLE_TEXT, cost: {amount: 0, currency: 'USD', externalRequests: provider === 'edge-neural' ? samples.reduce((sum, s) => sum + Number(s.synthesisRequests ?? 0), 0) : 0, estimated: false}, samples, subjectiveListening: 'not-tested', disclosure: provider === 'edge-neural' ? 'Нейросетевые голоса Microsoft Edge. Текст проб отправлен онлайн; платных API-вызовов нет. Коммерческие права отдельно не подтверждены.' : 'Локальные синтетические голоса Windows. Естественность и произношение требуют прослушивания.'};
  await writeJson(path.join(outputDir, 'voices-manifest.json'), result);
  await writeFile(path.join(outputDir, 'index.html'), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Пробы русской озвучки</title><style>body{font:18px system-ui;background:#101727;color:#e8edf9;max-width:800px;margin:60px auto;padding:24px}article{padding:24px;border:1px solid #394764;border-radius:16px;margin:18px 0}audio{width:100%}p{line-height:1.6}</style><h1>Русская озвучка</h1><p>${VOICE_SAMPLE_TEXT}</p>${samples.map(s => `<article><h2>${s.gender === 'female' ? 'Женский' : 'Мужской'} голос · ${provider} · ${speechRatePercent}%</h2><audio controls src="${s.gender}-ru${provider === 'edge-neural' ? '.mp3' : '.wav'}"></audio></article>`).join('')}<p>${result.disclosure} Техническое декодирование проверено. Субъективное качество пока не оценено.</p></html>`, 'utf8');
  return result;
}
