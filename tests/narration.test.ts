import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {narrationCacheKey, normalizeSpokenText, selectVoice, narrate, listNarrationVoices, inspectNarrationAudio, estimateNarrationCost, resolveNarrationProvider} from '../src/narration.js';
import {run} from '../src/util.js';

const female = {id: 'example-female', name: 'Example', gender: 'female', language: 'ru-RU', description: '', engineVersion: '1'};
test('voice cache includes text, voice, delivery and pronunciation dictionary', () => {
  const a = narrationCacheKey('Текст', female, 0);
  assert.notEqual(a, narrationCacheKey('Другой текст', female, 0));
  assert.notEqual(a, narrationCacheKey('Текст', {...female, id: 'other'}, 0));
  assert.notEqual(a, narrationCacheKey('Текст', female, 1));
  assert.notEqual(a, narrationCacheKey('Текст', female, 0, {API: 'эй пи ай'}));
  assert.equal(narrationCacheKey('UI API', female, 0, {UI: 'интерфейс', API: 'эй пи ай'}), narrationCacheKey('UI API', female, 0, {API: 'эй пи ай', UI: 'интерфейс'}));
});
test('normalization keeps literal text and explicit pronunciation; no fabricated alignment', () => {
  assert.equal(normalizeSpokenText('  Всё\nготово: API. ', {API: 'эй пи ай'}), 'Всё готово: эй пи ай.');
  assert.equal(normalizeSpokenText('$(Get-ChildItem); <script>'), '$(Get-ChildItem); <script>');
  assert.throws(() => normalizeSpokenText(' \n '), /empty/);
  assert.throws(() => normalizeSpokenText('x'.repeat(5001)), /too long/);
});
test('unavailable requested gender is never substituted', () => {
  assert.throws(() => selectVoice([female], 'male'), /unavailable/);
  assert.throws(() => selectVoice([female], 'male', female.id), /conflicts/);
  assert.equal(selectVoice([female], 'female').id, female.id);
  assert.deepEqual(estimateNarrationCost('Тест').externalRequests, 0);
});

test('real Windows TTS: rerun cache, single-text invalidation, WAV import and continuous track', {skip: process.platform !== 'win32', timeout: 120_000}, async () => {
  const voices = await listNarrationVoices();
  assert.ok(voices.some(v => v.gender === 'female'));
  assert.ok(voices.some(v => v.gender === 'male'));
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'product-demo-narration-'));
  try {
    const runDir = path.join(temporary, 'тест с пробелами');
    const cacheDir = path.join(temporary, 'cache');
    await mkdir(path.join(runDir, 'capture'), {recursive: true});
    const capture = path.join(runDir, 'capture', 'untouched.txt');
    await writeFile(capture, 'capture never rerun');
    const before = await stat(capture);
    const storyboard = {schemaVersion: 1, scenes: [{sceneId: 'intro', spokenText: 'Всё готово. Создадим проект.'}, {sceneId: 'result', spokenText: 'Результат уже на экране.'}]};
    await writeFile(path.join(runDir, 'storyboard.json'), JSON.stringify(storyboard));
    const options = {voice: 'female' as const, provider: 'windows-sapi', cacheDir, savePreference: false};
    const first = await narrate(runDir, options);
    assert.ok(first.segments.every(s => !s.cacheHit && s.durationMs > 300 && s.fullDecode === 'passed'));
    assert.equal(first.cost.amount, 0);
    const second = await narrate(runDir, options);
    assert.ok(second.segments.every(s => s.cacheHit));
    assert.deepEqual(second.segments.map(s => s.sha256), first.segments.map(s => s.sha256));
    const chosenVoice = voices.find(v => v.id === first.voiceId)!;
    const cachedFirst = path.join(cacheDir, `${narrationCacheKey(storyboard.scenes[0].spokenText, chosenVoice, 0)}.wav`);
    await writeFile(cachedFirst, 'intentionally corrupt cache');
    const repaired = await narrate(runDir, options);
    assert.equal(repaired.segments[0].cacheHit, false);
    assert.equal(repaired.segments[1].cacheHit, true);
    assert.ok(repaired.segments[0].durationMs > 300);
    storyboard.scenes[1].spokenText = 'Новый проект появился на экране.';
    await writeFile(path.join(runDir, 'storyboard.json'), JSON.stringify(storyboard));
    const third = await narrate(runDir, options);
    assert.equal(third.segments[0].cacheHit, true);
    assert.equal(third.segments[1].cacheHit, false);
    assert.equal((await stat(capture)).mtimeMs, before.mtimeMs);
    assert.equal(await readFile(capture, 'utf8'), 'capture never rerun');
    const voiceSwitched = await narrate(runDir, {...options, voice: 'male'});
    assert.notEqual(voiceSwitched.voiceId, first.voiceId);
    assert.ok(voiceSwitched.segments.every(s => !s.cacheHit));
    assert.equal((await stat(capture)).mtimeMs, before.mtimeMs);
    const importedPath = path.join(runDir, first.segments[0].path);
    const continuous = await narrate(runDir, {...options, narrationFile: importedPath});
    assert.equal(continuous.provider, 'local-import');
    assert.equal(continuous.alignment, 'none');
    assert.ok(continuous.fullTrack);
    assert.equal(continuous.segments.length, 0);
    await writeFile(path.join(runDir, 'storyboard.json'), JSON.stringify({...storyboard, scenes: [storyboard.scenes[0]]}));
    const imported = await narrate(runDir, {...options, narrationFile: importedPath});
    assert.equal(imported.segments[0].sha256, first.segments[0].sha256);
    assert.equal(imported.synthetic, null);
    assert.equal(imported.voiceId, null);
    assert.equal(imported.voice, 'unknown');
    assert.match(imported.disclosure, /человеческую или синтетическую/);
    const decoded = await inspectNarrationAudio(path.join(runDir, imported.segments[0].path));
    assert.equal(decoded.fullDecode, 'passed');
    const mp3 = path.join(temporary, 'импорт с пробелами.mp3');
    await run('ffmpeg', ['-y', '-v', 'error', '-i', importedPath, '-c:a', 'libmp3lame', mp3]);
    const importedMp3 = await narrate(runDir, {...options, narrationFile: mp3});
    assert.equal(importedMp3.segments[0].fullDecode, 'passed');
    assert.ok(importedMp3.segments[0].path.endsWith('.mp3'));
    await writeFile(`${mp3}.segments.json`, JSON.stringify([{sceneId: 'intro', startMs: 0, endMs: 1000}]));
    const mapped = await narrate(runDir, {...options, narrationFile: mp3});
    assert.ok(Math.abs(mapped.segments[0].durationMs - 1000) < 1);
    await writeFile(`${mp3}.segments.json`, JSON.stringify([{sceneId: '../escape', startMs: 0, endMs: 1000}]));
    await assert.rejects(narrate(runDir, {...options, narrationFile: mp3}), /Invalid/);
    assert.ok((await readdir(cacheDir)).some(f => f.endsWith('.wav')));
  } finally {await rm(temporary, {recursive: true, force: true});}
});

test('natural provider requires text transmission consent and never silently falls back to legacy SAPI', () => {
  assert.throws(() => resolveNarrationProvider('auto'), /allow-external-tts/);
  assert.throws(() => resolveNarrationProvider('edge-neural', false), /No voice was substituted/);
  assert.equal(resolveNarrationProvider('auto', true), 'edge-neural');
  assert.equal(resolveNarrationProvider('windows-sapi', false), 'windows-sapi');
  assert.notEqual(narrationCacheKey('Текст', female, 0, {}, 'windows-sapi'), narrationCacheKey('Текст', female, 0, {}, 'edge-neural'));
});

test('real neural Russian speech: measured audio, cache reuse, one-segment invalidation and no recapture', {skip: process.env.PRODUCT_DEMO_TEST_NEURAL !== '1', timeout: 120_000}, async () => {
  const voices = await listNarrationVoices('ru-RU', 'edge-neural');
  assert.ok(voices.some(v => v.id === 'ru-RU-SvetlanaNeural' && v.gender === 'female'));
  assert.ok(!voices.some(v => v.id === 'ru-RU-DariyaNeural'));
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'product-demo-neural-'));
  try {
    const runDir = path.join(temporary, 'Нейронный тест');
    await mkdir(path.join(runDir, 'capture'), {recursive: true});
    const capture = path.join(runDir, 'capture', 'existing-recording.txt');
    await writeFile(capture, 'no recapture');
    const captureTime = (await stat(capture)).mtimeMs;
    const storyboard = {schemaVersion: 1, scenes: [{sceneId: 'intro', spokenText: 'Создадим новый проект.'}, {sceneId: 'result', spokenText: 'Всё готово. Можно начинать.'}]};
    await writeFile(path.join(runDir, 'storyboard.json'), JSON.stringify(storyboard));
    const options = {provider: 'edge-neural', allowExternalTts: true, voice: 'female' as const, speechRatePercent: 0, cacheDir: path.join(temporary, 'cache'), savePreference: false};
    const first = await narrate(runDir, options);
    assert.equal(first.provider, 'edge-neural');
    assert.equal(first.voiceId, 'ru-RU-SvetlanaNeural');
    assert.equal(first.cost.amount, 0); assert.ok(first.cost.externalRequests >= 2 && first.cost.externalRequests <= 4);
    assert.ok(first.segments.every(s => s.sampleRate === 24000 && s.durationMs > 500 && s.fullDecode === 'passed'));
    const second = await narrate(runDir, options);
    assert.ok(second.segments.every(s => s.cacheHit)); assert.equal(second.cost.externalRequests, 0);
    storyboard.scenes[1].spokenText = 'Проект готов. Начнём работу.';
    await writeFile(path.join(runDir, 'storyboard.json'), JSON.stringify(storyboard));
    const third = await narrate(runDir, options);
    assert.equal(third.segments[0].cacheHit, true); assert.equal(third.segments[1].cacheHit, false);
    assert.ok(third.cost.externalRequests >= 1 && third.cost.externalRequests <= 2);
    assert.equal((await stat(capture)).mtimeMs, captureTime);
    await assert.rejects(narrate(runDir, {...options, allowExternalTts: false}), /allow-external-tts/);
    const male = await narrate(runDir, {...options, voice: 'male'});
    assert.equal(male.voiceId, 'ru-RU-DmitryNeural');
    assert.ok(male.segments.every(s => s.fullDecode === 'passed'));
  } finally {await rm(temporary, {recursive: true, force: true});}
});
