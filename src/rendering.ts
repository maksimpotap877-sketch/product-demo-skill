import {executeReviewedStage} from './execution.js';
import {bundle} from '@remotion/bundler';
import {renderMedia,selectComposition} from '@remotion/renderer';
import {chromium} from 'playwright';
import {mkdir,copyFile,readFile,stat,access,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {statfs} from 'node:fs/promises';
import {EditPlanSchema} from './schema.js';
import {PACKAGE_ROOT,readJson,writeJson,run,safeFile,hash,log} from './util.js';
import {mixAudio} from './audio.js';
import {validateRenderMedia} from './render-input.js';
/** Rendering does not require Playwright's exact browser revision; prefer an installed headless shell. */
export async function resolveRenderBrowser(){
 const expected=chromium.executablePath();
 const roots=[path.dirname(path.dirname(path.dirname(expected))),path.join(os.homedir(),'AppData/Local/ms-playwright')];
 if(process.env.PLAYWRIGHT_BROWSERS_PATH&&process.env.PLAYWRIGHT_BROWSERS_PATH!=='0')roots.unshift(path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH));
 for(const root of [...new Set(roots)]){
  const entries=await readdir(root,{withFileTypes:true}).catch(()=>[]);
  const shells=entries.filter(e=>e.isDirectory()&&/^chromium_headless_shell-\d+$/.test(e.name)).sort((a,b)=>Number(b.name.split('-').at(-1))-Number(a.name.split('-').at(-1)));
  for(const entry of shells)for(const tail of ['chrome-headless-shell-win64/chrome-headless-shell.exe','chrome-headless-shell-linux64/chrome-headless-shell','chrome-headless-shell-mac-arm64/chrome-headless-shell','chrome-headless-shell-mac-x64/chrome-headless-shell']){
   const candidate=path.join(root,entry.name,tail);try{await access(candidate);return{browserExecutable:candidate,chromeMode:'headless-shell' as const};}catch{}
  }
 }
 try{await access(expected);return{browserExecutable:expected,chromeMode:'chrome-for-testing' as const};}catch{}
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
 try{await access(edge);return{browserExecutable:edge,chromeMode:'chrome-for-testing' as const};}catch{}
 throw new Error('No installed render browser. Install the Chromium headless shell with Playwright before rendering.');
}
export async function renderCodeFingerprint(root=PACKAGE_ROOT){
 const renderDirectory=path.join(root,'dist/render');
 const paths=(await readdir(renderDirectory,{recursive:true})).filter(f=>f.endsWith('.js')).map(f=>path.join('dist/render',f));
 paths.push('dist/rendering.js','dist/render-input.js','dist/audio.js');
 paths.sort();
 return Promise.all(paths.map(async file=>({file:file.replaceAll('\\','/'),sha256:hash(await readFile(path.join(root,file)))})));
}
export async function renderRun(runDir:string,profile?:string,analysisFile?:string){
 const config=await readJson(path.join(runDir,'resolved-config.json'));
 if(analysisFile)config.analysisFile=analysisFile;
 const plan=await readJson(path.join(runDir,profile?'edit-plan-'+profile+'.json':'edit-plan.json'));
 return executeReviewedStage({config,runDir,stage:'render',inputs:{profile,plan},execute:()=>renderReviewed(runDir,profile)});
}
async function renderReviewed(runDir:string,profile?:string){const plan=EditPlanSchema.parse(await readJson(path.join(runDir,profile?`edit-plan-${profile}.json`:'edit-plan.json')));const preflight=await validateRenderMedia(runDir,plan);await writeJson(path.join(runDir,'review',`geometry-preflight-${plan.profile.name}.json`),preflight);const stage=path.join(runDir,'.render-assets');await mkdir(stage,{recursive:true});const paths=[...new Set(plan.scenes.flatMap(s=>[s.sourcePath,...(s.voicePath?[s.voicePath]:[])]).concat(plan.fullTrack?[plan.fullTrack]:[]))];const contents=[hash(await renderCodeFingerprint())];for(const p of paths){const src=await safeFile(runDir,p);const dest=path.join(stage,p);await mkdir(path.dirname(dest),{recursive:true});await copyFile(src,dest);contents.push(hash(await readFile(src)));}
 const config=await readJson(path.join(runDir,'resolved-config.json'));const musicFile=config.musicFile?path.resolve(config.project,config.musicFile):undefined;if(musicFile)contents.push(hash(await readFile(musicFile)));const cacheKey=hash({plan,contents,version:2});const checkpoint=path.join(runDir,`renders/render-${plan.profile.name}.json`);try{const previous=await readJson(checkpoint);if(previous.cacheKey===cacheKey){await stat(previous.file);return {...previous,cacheHit:true};}}catch{}
 const disk=await statfs(runDir);const estimatedDiskBytes=Math.max(2e9,plan.profile.width*plan.profile.height*plan.durationFrames/6);const minimumFreeRam=plan.profile.width>=3840&&plan.profile.fps>=144?8e9:2e9;if(disk.bavail*disk.bsize<estimatedDiskBytes||os.freemem()<minimumFreeRam)throw new Error('Insufficient render resource budget: free disk/RAM below conservative estimate');await writeJson(path.join(runDir,'logs',`resources-${plan.profile.name}.json`),{schemaVersion:1,estimatedDiskBytes,freeDiskBytes:disk.bavail*disk.bsize,minimumFreeRam,freeRamBytes:os.freemem(),concurrency:8});
 await mkdir(path.join(runDir,'renders'),{recursive:true});const raw=path.join(runDir,`renders/intermediate-${plan.profile.name}.mp4`);const final=path.join(runDir,`renders/demo-${plan.profile.name}-degraded.mp4`);
 const serveUrl=await bundle({entryPoint:path.join(PACKAGE_ROOT,'dist/render/index.js'),publicDir:stage,onProgress:()=>undefined});const browser=await resolveRenderBrowser();const props={plan};const composition=await selectComposition({serveUrl,id:'ProductDemo',inputProps:props,...browser,logLevel:'error'});let last=-1;
 await renderMedia({serveUrl,composition,inputProps:props,outputLocation:raw,codec:'h264',crf:17,pixelFormat:'yuv420p',x264Preset:'fast',imageFormat:'jpeg',jpegQuality:95,concurrency:8,...browser,logLevel:'error',muted:true,onProgress:({progress})=>{const n=Math.floor(progress*10);if(n!==last){last=n;log(`render ${plan.profile.name}: ${n*10}%`);}}});
 const duration=plan.durationFrames/plan.profile.fps;const {mixPath:mix}=await mixAudio(plan,runDir,musicFile);
 const measure=await run('ffmpeg',['-hide_banner','-i',mix,'-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-']);const match=measure.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);if(!match)throw new Error('Loudness measurement missing');const m=JSON.parse(match[0]);const norm=`loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
 await run('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',raw,'-i',mix,'-map','0:v:0','-map','1:a:0','-c:v','copy','-af',norm,'-ar','48000','-c:a','aac','-b:a','192k','-t',String(duration),'-movflags','+faststart',final],{timeoutMs:300000});const result={schemaVersion:1,file:final,cacheKey,profile:plan.profile,status:'degraded',nativeCapture144:false,source:'hybrid',cacheHit:false,loudnessTargetLUFS:-16,peakTargetDbTP:-1.5,sourceLoudness:m};await writeJson(checkpoint,result);return result;
}
