import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mixAudio} from '../src/audio.js';
import {run, probe} from '../src/util.js';
import {EditPlanSchema} from '../src/schema.js';

test('real audio mix preserves separate stems and ducks local music while voice is active', {timeout: 30_000}, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'product-demo-audio-'));
  try {
    await mkdir(path.join(temporary, 'narration'), {recursive: true});
    const voice = path.join(temporary, 'narration', 'voice.wav');
    const music = path.join(temporary, 'own-test-music.wav');
    // Generated diagnostic tones, not third-party music or a fake narration acceptance test.
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=900:sample_rate=22050:duration=2', '-af', 'volume=3', voice]);
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=200:sample_rate=44100:duration=4', music]);
    const plan = EditPlanSchema.parse({schemaVersion: 1, runId: 'audio-test', toolVersion: '0.1.0', profile: {name: 'test', width: 1920, height: 1080, fps: 60}, durationFrames: 240, transitionFrames: 0, title: 'Test', accent: '#7666ec', viewportCss: {width: 1600, height: 900}, sourcePixels: {width: 2560, height: 1440}, scenes: [{sceneId: 'one', kind: 'screenshot', sourcePath: 'unused.png', sourceStartMs: 0, sourceEndMs: 4000, sourceDurationMs: 4000, outputStartFrame: 0, outputDurationFrames: 240, playbackRate: 1, voicePath: 'narration/voice.wav', voiceDurationMs: 2000, title: 'Test', caption: 'Test', camera: [{frame: 0, scale: 1, x: 0.5, y: 0.5}], events: []}], provenance: ['audio-only test']});
    const mixed = await mixAudio(plan, temporary, music);
    assert.ok(mixed.musicPath);
    const media = await probe(mixed.mixPath);
    assert.equal(Number(media.streams[0].sample_rate), 48000);
    assert.equal(Number(media.streams[0].channels), 2);
    assert.ok(Math.abs(Number(media.format.duration) - 4) < 0.001);
    const measure = async (start: number, duration: number) => {
      const value = await run('ffmpeg', ['-hide_banner', '-ss', String(start), '-t', String(duration), '-i', mixed.musicPath!, '-af', 'volumedetect', '-f', 'null', '-']);
      const matched = value.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
      assert.ok(matched); return Number(matched[1]);
    };
    const speechActive = await measure(0.8, 0.4);
    const speechInactive = await measure(2.9, 0.2);
    assert.ok(speechActive < speechInactive - 8, `Expected measurable ducking: active ${speechActive} dB, inactive ${speechInactive} dB`);
    const saved = JSON.parse(await readFile(mixed.manifestPath, 'utf8'));
    assert.equal(saved.ducking.method, 'ffmpeg sidechaincompress');
    assert.notEqual(saved.voice, saved.music);
    const noMusic = await mixAudio(plan, temporary);
    assert.equal(noMusic.musicPath, undefined);
    assert.deepEqual(await readFile(noMusic.mixPath), await readFile(noMusic.voicePath));
  } finally {await rm(temporary, {recursive: true, force: true});}
});
