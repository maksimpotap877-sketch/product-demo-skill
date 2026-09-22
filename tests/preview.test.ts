import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {request} from 'node:http';
import type {Server} from 'node:http';
import {previewRun} from '../src/preview.js';
import {run, writeJson} from '../src/util.js';

function get(url: string, target: string, headers: Record<string, string> = {}) {
  return new Promise<{status: number; headers: import('node:http').IncomingHttpHeaders; data: Buffer}>((resolve, reject) => {
    const base = new URL(url);
    const req = request({hostname: base.hostname, port: base.port, path: target, method: 'GET', headers}, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode!, headers: res.headers, data: Buffer.concat(chunks)}));
    });
    req.on('error', reject); req.end();
  });
}

test('loopback preview serves actual allowlisted media, ranges and escaped text; blocks secrets and path escape', {timeout: 30_000}, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'product-demo-preview-'));
  const runDir = path.join(temporary, 'run');
  const privateDir = path.join(temporary, 'private');
  const sentinel = 'PRIVATE_TEST_SENTINEL_729468';
  let server: Server | undefined;
  try {
    await mkdir(path.join(runDir, 'renders'), {recursive: true});
    await mkdir(path.join(runDir, 'review'), {recursive: true});
    await mkdir(path.join(runDir, 'narration'), {recursive: true});
    await mkdir(privateDir);
    await writeFile(path.join(privateDir, '.env'), sentinel);
    await writeFile(path.join(runDir, '.env'), sentinel);
    const video = path.join(runDir, 'renders', 'fixture.mp4');
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=12:duration=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=0.5', path.join(runDir, 'narration', 'fixture.wav')]);
    await run('ffmpeg', ['-y', '-v', 'error', '-i', video, '-frames:v', '1', path.join(runDir, 'review', 'contact-sheet.png')]);
    // A directory junction is non-administrative on Windows and tests realpath enforcement.
    await symlink(privateDir, path.join(runDir, 'escaped-link'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeJson(path.join(runDir, 'edit-plan.json'), {profile: {name: 'web-60', width: 128, height: 72, fps: 12}});
    await writeJson(path.join(runDir, 'renders', 'render-web-60.json'), {file: video});
    await writeJson(path.join(runDir, 'review', 'quality-report.json'), {status: 'degraded', checks: [{status: 'not-tested', name: 'fixture'}]});
    await writeJson(path.join(runDir, 'storyboard.json'), {title: '<script>window.PWNED=true</script>', scenes: [{displayText: '<img src=x onerror=alert(1)>', spokenText: 'Локальная тестовая страница'}]});
    await writeJson(path.join(runDir, 'narration', 'narration-manifest.json'), {segments: [{sceneId: 'safe', path: 'narration/fixture.wav'}, {sceneId: 'traversal', path: '../private/.env'}, {sceneId: 'junction', path: 'escaped-link/.env'}, {sceneId: 'absolute', path: path.join(privateDir, '.env')}]});
    const preview = await previewRun(runDir); server = preview.server;
    assert.equal((server.address() as import('node:net').AddressInfo).address, '127.0.0.1');
    const page = await get(preview.url, '/');
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-security-policy']), /default-src 'self'/);
    assert.ok(page.data.toString().includes('&lt;script&gt;'));
    assert.ok(!page.data.toString().includes('<script>window.PWNED'));
    const bytes = await readFile(video);
    const media = await get(preview.url, '/media/video');
    assert.equal(media.status, 200);
    assert.equal(media.headers['content-type'], 'video/mp4');
    assert.deepEqual(media.data, bytes);
    const part = await get(preview.url, '/media/video', {Range: 'bytes=0-15'});
    assert.equal(part.status, 206);
    assert.equal(part.headers['content-range'], `bytes 0-15/${bytes.length}`);
    assert.deepEqual(part.data, bytes.subarray(0, 16));
    const end = await get(preview.url, '/media/video', {Range: `bytes=${bytes.length - 8}-`});
    assert.equal(end.status, 206); assert.deepEqual(end.data, bytes.subarray(-8));
    assert.equal((await get(preview.url, '/media/video', {Range: `bytes=${bytes.length + 1}-`})).status, 416);
    for (const route of ['/.env', '/sources/.env', '/auth/checkpoint.json', '/media/../.env', '/media/%2e%2e/.env', '/media/%2e%2e%2f.env', '/media/%2e%2e%5c.env', '/media/../../private/.env', '/media/audio1', '/media/audio2', '/media/audio3', '/media/unknown']) {
      const response = await get(preview.url, route);
      assert.equal(response.status, 404, route);
      assert.ok(!response.data.includes(Buffer.from(sentinel)), route);
    }
    assert.equal((await get(preview.url, '/media/audio0')).status, 200);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(temporary, {recursive: true, force: true});
  }
});
