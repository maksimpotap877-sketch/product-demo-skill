import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {run} from '../src/util.js';
import {validateRenderMedia} from '../src/render-input.js';
test('render preflight checks actual durations and source geometry rather than edited JSON claims',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'demo-range-'));try{await run('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=white:s=64x64:r=25','-t','1','-c:v','libx264',path.join(dir,'clip.mp4')]);const s={sceneId:'test',kind:'video',sourcePath:'clip.mp4',sourceStartMs:0,sourceEndMs:900,sourceDurationMs:5000,sourcePixels:{width:64,height:64},outputDurationFrames:60,camera:[{frame:0,scale:1,x:.5,y:.5}]};const p:any={profile:{width:1920,height:1080,fps:60},sourcePixels:{width:64,height:64},scenes:[s]};assert.equal((await validateRenderMedia(dir,p)).status,'passed');await assert.rejects(validateRenderMedia(dir,{...p,scenes:[{...s,sourceEndMs:2000}]}),/actual media/);await assert.rejects(validateRenderMedia(dir,{...p,scenes:[{...s,sourcePixels:{width:128,height:128}}]}),/dimensions differ/);await assert.rejects(validateRenderMedia(dir,{...p,sourcePixels:{width:128,height:64},scenes:[{...s,sourcePixels:undefined}]}),/aspect differs/);}finally{await rm(dir,{recursive:true,force:true});}});
