import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMarkerFrames,redactUrl,authProfilePath,capture,validateCaptureCacheAssets,captureInputFingerprint,validateCaptureOrigins} from '../src/capture.js';
import {makeExampleConfig} from '../src/discovery.js';
import {DemoConfigSchema} from '../src/schema.js';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('capture metadata strips URL credentials, query and fragment',()=>{
  assert.equal(redactUrl('https://name:secret@example.com/view?token=supersecret#session=secret'),'https://example.com/view');
});
test('native benchmark rejects high metadata fps with repeated visual markers',()=>{
  const times=Array.from({length:577},(_,i)=>i*1000/144);const repeated=times.map((_,i)=>Math.floor(i/6)+1);
  const report=analyzeMarkerFrames(repeated,times,144);assert.equal(report.status,'degraded');assert.ok(report.uniqueUpdatesFps<25);assert.ok(report.duplicateFrames>400);
});
test('native benchmark accepts only a sufficient number of distinct updates with bounded gaps',()=>{
  const times=Array.from({length:577},(_,i)=>i*1000/144),ids=times.map((_,i)=>i+1);assert.equal(analyzeMarkerFrames(ids,times,144).status,'passed');
  times[300]+=40;assert.equal(analyzeMarkerFrames(ids,times,144).status,'degraded');
});
test('auth profile differs between projects and never sits inside output',()=>{
  const a=authProfilePath({url:'http://127.0.0.1:4173',project:'C:/one project'}),b=authProfilePath({url:'http://127.0.0.1:4173',project:'C:/второй проект'});assert.notEqual(a,b);assert.ok(a.includes('product-demo-toolkit'));assert.ok(!a.includes('output'));
});
test('two examples use different scenarios through the same validated config',()=>{
  const basic=makeExampleConfig(process.cwd(),'basic',4173),second=makeExampleConfig(process.cwd(),'second',4174);DemoConfigSchema.parse(basic);DemoConfigSchema.parse(second);assert.notDeepEqual(basic.actions,second.actions);assert.equal(second.storyboard.scenes[1].screenshotId,'library');
});
test('strict-native mode rejects even when a complete hybrid cache exists',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'product-demo-cache-test-'));await mkdir(path.join(root,'capture'));await writeFile(path.join(root,'capture','capture-manifest.json'),JSON.stringify({complete:true,status:'passed',clips:[{path:'../../private.webm'}],screenshots:[]}));
  const config=makeExampleConfig(root);config.strictNativeFps=true;await assert.rejects(capture(config,root),/strict_native_fps_blocked/);
});
test('cache rejects traversal and absent integrity hashes before opening media',async()=>{
  assert.equal(await validateCaptureCacheAssets({clips:[{path:'../../secret.webm',sha256:'x'}],screenshots:[]},process.cwd()),false);
  assert.equal(await validateCaptureCacheAssets({clips:[{path:'capture/clips/clip-001.webm'}],screenshots:[]},process.cwd()),false);
});
test('web source changes invalidate capture fingerprint; voice config and secrets are not read',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'product-demo-source-test-'));await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src','app.ts'),'export const label="before"');await writeFile(path.join(root,'.env'),'FAKE_KEY=not-a-real-secret');await writeFile(path.join(root,'demo.config.ts'),'voice: female');
  const config={...makeExampleConfig(root),start:undefined};const before=await captureInputFingerprint(config);await writeFile(path.join(root,'demo.config.ts'),'voice: male');assert.equal((await captureInputFingerprint(config)).digest,before.digest);await writeFile(path.join(root,'src','app.ts'),'export const label="after"');assert.notEqual((await captureInputFingerprint(config)).digest,before.digest);assert.ok(before.files.every(f=>!f.includes('.env')));
});
test('capture library rejects local-file URLs, URL credentials and non-origin allowlists',()=>{
  assert.throws(()=>validateCaptureOrigins({url:'file:///C:/private.txt'}));assert.throws(()=>validateCaptureOrigins({url:'https://user:pass@example.test'}));assert.throws(()=>validateCaptureOrigins({url:'https://example.test',allowedOrigins:['https://example.test/private']}));
});
