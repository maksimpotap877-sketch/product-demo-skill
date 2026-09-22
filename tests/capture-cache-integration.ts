import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {capture,captureInputFingerprint,type CaptureConfig} from '../src/capture.js';
import {createUnderstandingDraft,assertUnderstanding,type UnderstandingManifest} from '../src/understanding.js';
import {writeJson} from '../src/util.js';

// Opt-in: this test launches a local server/browser and records two short clips.
if(!process.argv.includes('--real')){
  console.log('Run with --real to check reviewed source changes against real browser capture cache.');
  process.exit(0);
}

const listener=createServer();
await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));
const address=listener.address();assert.ok(address&&typeof address==='object');const port=address.port;
await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));

const project=await mkdtemp(path.join(os.tmpdir(),'product-demo-real-cache-'));
const sourceDir=path.join(project,'unlisted-demo-pages'),runDir=path.join(project,'output','capture-cache-regression');
await mkdir(sourceDir);await mkdir(runDir,{recursive:true});
const serverSource=[
  "import http from 'node:http';",
  "import {readFile} from 'node:fs/promises';",
  "const page = new URL('./index.html', import.meta.url);",
  "http.createServer(async (_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(await readFile(page));}).listen(Number(process.argv[2]),'127.0.0.1');",
  "process.on('SIGTERM',()=>process.exit(0));",
  ''
].join('\n');
const fixtureHtml=(revision:'A'|'B')=>`<!doctype html><html lang="en"><meta charset="utf-8"><title>Source cache fixture</title><style>body{margin:0;background:#182234;color:#fff;font:32px Arial;padding:100px}small{color:#a9b9d3;font-size:20px}h1{margin:24px 0}p{color:#bbcce6;font-size:24px}</style><main data-testid="fixture-ready"><small>Real local capture cache regression</small><h1>Visible source revision ${revision}</h1><p>This page has no network calls or stored data.</p></main></html>\n`;
await writeFile(path.join(sourceDir,'server.mjs'),serverSource);
await writeFile(path.join(sourceDir,'index.html'),fixtureHtml('A'));
const config:CaptureConfig={
  project,url:`http://127.0.0.1:${port}`,allowedOrigins:[`http://127.0.0.1:${port}`],
  start:{command:process.execPath,args:[path.join(sourceDir,'server.mjs'),String(port)],cwd:project},
  readyLocator:{testid:'fixture-ready'},viewportCss:{width:960,height:540},capturePixels:{width:960,height:540},captureTargetFps:144,durationSec:3,
  actions:[{type:'waitFor',locator:{testid:'fixture-ready'}},{type:'pause',ms:1100},{type:'screenshot',name:'revision'},{type:'pause',ms:1100}]
};

// Authoring is restricted to the exact two source literals above. It cannot be
// reused to approve unrelated products or arbitrary modified source files.
async function reviewFixture(revision:'A'|'B'){
  const draft=await createUnderstandingDraft({project,config,sourceRequests:[{path:'unlisted-demo-pages/server.mjs'},{path:'unlisted-demo-pages/index.html'}]});
  assert.equal(draft.readings[0].content,serverSource);assert.equal(draft.readings[1].content,fixtureHtml(revision));
  const manifest:UnderstandingManifest={...draft.manifest,status:'ready',authoredBy:'Exact cache regression fixture review',
    product:{name:'Source cache fixture',purpose:'A local static page exposes a visible revision label to test capture invalidation after reviewed source changes.',audience:'Developers testing browser capture cache integrity',primaryOutcome:`The browser screenshot shows the literal heading Visible source revision ${revision}.`},
    safeStart:{...draft.manifest.safeStart,explanation:'Run the exact fixture Node server with a direct argv on a selected loopback port; it only reads this local HTML file.',evidenceIds:['source-001']},
    flow:[{id:'visible-revision',summary:`Wait for the static fixture and record the visible revision ${revision} label.`,actionIndexes:[0],evidenceIds:['source-002'],success:{description:'The static main element containing the revision heading is visible.',locator:{testid:'fixture-ready'}}}],
    limitations:['This is an isolated test page with no interactions, account, persistence or external requests. The measured browser video is hybrid capture and does not establish native 144 fps.']
  };
  await writeJson(path.join(project,'demo.understanding.json'),manifest);
  await assertUnderstanding({project,config});
}

await reviewFixture('A');
const fingerprintBefore=await captureInputFingerprint(config);
assert.ok(!fingerprintBefore.files.some(p=>p.endsWith('index.html')),'The regression must exercise a source folder omitted by the old root whitelist');
const first=await capture(config,runDir);assert.equal(first.complete,true);assert.notEqual(first.cacheHit,true);
const firstClipMtime=(await stat(path.join(runDir,first.clips[0].path))).mtimeMs;
const beforeShot=path.join(runDir,'before-source-change.png');await copyFile(path.join(runDir,first.screenshots[0].path),beforeShot);
const second=await capture(config,runDir);assert.equal(second.cacheHit,true);
assert.equal((await stat(path.join(runDir,second.clips[0].path))).mtimeMs,firstClipMtime);

await writeFile(path.join(sourceDir,'index.html'),fixtureHtml('B'));
await assert.rejects(assertUnderstanding({project,config}),/source_stale:source-002/);
await reviewFixture('B');
const fingerprintAfter=await captureInputFingerprint(config);
assert.equal(fingerprintAfter.digest,fingerprintBefore.digest,'Only the reviewed source evidence should catch this previously omitted HTML change');
const third=await capture(config,runDir);assert.equal(third.complete,true);assert.notEqual(third.cacheHit,true);
assert.notEqual(third.inputHash,first.inputHash);assert.notEqual(third.screenshots[0].sha256,first.screenshots[0].sha256);
const afterShot=path.join(runDir,'after-source-change.png');await copyFile(path.join(runDir,third.screenshots[0].path),afterShot);
const digest=async(file:string)=>createHash('sha256').update(await readFile(file)).digest('hex');
const report={schemaVersion:1,status:'passed',project,runDir,checks:{firstRealCapture:first.complete,secondCaptureCacheHit:second.cacheHit,unchangedLegacyFingerprint:fingerprintAfter.digest===fingerprintBefore.digest,staleAnalysisBlocked:true,updatedReviewForcesRealCapture:third.cacheHit!==true,sourceCaptureHashChanged:third.inputHash!==first.inputHash,screenshotContentChanged:third.screenshots[0].sha256!==first.screenshots[0].sha256},screenshots:{before:{path:beforeShot,sha256:await digest(beforeShot)},after:{path:afterShot,sha256:await digest(afterShot)}},encodedFps:third.clips[0].fps,native144:'not-achieved',tts:'not-run',render:'not-run'};
await writeJson(path.join(runDir,'cache-regression-report.json'),report);
console.log(JSON.stringify(report,null,2));
