import {executeReviewedStage} from './execution.js';
import {chromium,type Browser,type BrowserContext,type Page,type Locator,type LaunchOptions} from 'playwright';
import {mkdir,readFile,writeFile,access,rm,rename,readdir,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {hash,probe,run,writeJson,readJson,safeFile,VERSION} from './util.js';
import {ensureServer,type StartSpec} from './discovery.js';

export type SemanticLocator={role:string;name?:string}|{label:string}|{text:string}|{testid:string}|{css:string};
export type CaptureAction={type:'click'|'fill'|'type'|'hover'|'scroll'|'waitFor'|'pause'|'marker'|'screenshot';locator?:SemanticLocator;value?:string;ms?:number;x?:number;y?:number;name?:string};
export interface CaptureConfig {url:string;project?:string;analysisFile?:string;allowedOrigins?:string[];start?:StartSpec;readyLocator?:SemanticLocator;auth?:{required?:boolean;expectedLocator?:SemanticLocator;timeoutMs?:number};viewportCss:{width:number;height:number};capturePixels:{width:number;height:number};captureTargetFps:number;strictNativeFps?:boolean;actions:CaptureAction[];durationSec?:number}
export function redactUrl(value:string){try{const u=new URL(value);return u.origin+u.pathname;}catch{return 'about:blank';}}
export function validateCaptureOrigins(config:Pick<CaptureConfig,'url'|'allowedOrigins'>){
  const u=new URL(config.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('capture_requires_http_url_without_credentials');
  for(const origin of config.allowedOrigins||[]){const o=new URL(origin);if(!['http:','https:'].includes(o.protocol)||o.username||o.password||o.search||o.hash||o.pathname!=='/')throw new Error('allowed_origins_must_be_http_origins');}
}
async function fileDigest(file:string){return createHash('sha256').update(await readFile(file)).digest('hex');}
export async function captureInputFingerprint(config:CaptureConfig){
  const files:{path:string;sha256:string}[]=[];let complete=true,totalBytes=0;
  const project=path.resolve(config.project||process.cwd());const skip=new Set(['node_modules','sources','output','outputs','dist','build','.git','.agents','.codex','auth','.auth','.next','coverage']);
  const add=async(file:string,label:string)=>{if(files.length>=1000){complete=false;return;}const s=await stat(file);if(s.size>5_000_000||totalBytes+s.size>50_000_000){complete=false;return;}totalBytes+=s.size;files.push({path:label,sha256:await fileDigest(file)});};
  const scan=async(dir:string,depth:number)=>{if(depth>12){complete=false;return;}for(const e of await readdir(dir,{withFileTypes:true})){if(skip.has(e.name)||e.name.startsWith('.')||/^demo\.config\./.test(e.name)||/secret|credential|password|token/i.test(e.name))continue;const f=path.join(dir,e.name);if(e.isSymbolicLink()){complete=false;continue;}if(e.isDirectory()){if(depth>0||['src','app','pages','public','examples','components','packages'].includes(e.name))await scan(f,depth+1);}else if(/\.(?:[cm]?jsx?|tsx?|html|css|scss)$/.test(e.name)||['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock'].includes(e.name))await add(f,path.relative(project,f));}};
  const ownExampleServer=fileURLToPath(new URL('../examples/server.mjs',import.meta.url));const bundledExample=config.start?.args?.some(a=>path.resolve(config.start?.cwd||project,a)===ownExampleServer);
  if(!bundledExample)await scan(project,0);
  for(const arg of config.start?.args||[]){if(/\.(?:[cm]?js|ts)$/.test(arg)){const f=path.resolve(config.start?.cwd||project,arg);try{await add(f,'explicit-start:'+f);}catch{complete=false;}}}
  if(bundledExample){const name=config.start?.args.includes('--second')?'second-web':'basic-web';await add(path.join(path.dirname(ownExampleServer),name,'index.html'),'bundled-example:'+name);}
  files.sort((a,b)=>a.path.localeCompare(b.path));return{digest:hash(files),complete,files:files.map(f=>f.path)};
}
export async function validateCaptureCacheAssets(manifest:any,runDir:string){
  if(!Array.isArray(manifest.clips)||!Array.isArray(manifest.screenshots)||!manifest.clips.length)return false;
  for(const item of [...manifest.clips,...manifest.screenshots]){
    if(typeof item.path!=='string'||!/^capture\/(clips|screenshots)\/[\p{L}\p{N}_-]+\.(webm|png)$/u.test(item.path)||typeof item.sha256!=='string')return false;
    const file=await safeFile(runDir,item.path);if(await fileDigest(file)!==item.sha256)return false;
  }return true;
}
export function resolveLocator(page:Page,loc:SemanticLocator|Locator):Locator {
  if(typeof (loc as Locator).click==='function')return loc as Locator;
  if('role'in loc)return page.getByRole(loc.role as any,{name:loc.name,exact:!!loc.name});
  if('label'in loc)return page.getByLabel(loc.label,{exact:true});
  if('text'in loc)return page.getByText(loc.text,{exact:true});
  if('testid'in loc)return page.getByTestId(loc.testid);
  if('css'in loc)return page.locator(loc.css);
  throw new Error('unsupported_locator');
}
async function uniqueLocator(page:Page,loc:SemanticLocator|Locator){const l=resolveLocator(page,loc);await l.waitFor({state:'visible',timeout:15000});if(await l.count()!==1)throw new Error('ambiguous_locator');return l;}
export async function browserLaunchOptions(headless=true):Promise<LaunchOptions>{try{await access(chromium.executablePath());return{headless};}catch{return{headless,channel:'msedge'};}}
export function authProfilePath(config:Pick<CaptureConfig,'url'|'project'>){const base=process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share');return path.join(base,'product-demo-toolkit','auth',hash({origin:new URL(config.url).origin,project:path.resolve(config.project||process.cwd())}).slice(0,24));}
async function protectProfile(dir:string){await mkdir(dir,{recursive:true,mode:0o700});if(process.platform==='win32'){const {stdout}=await run('whoami',[]);await run('icacls',[dir,'/inheritance:r','/grant:r',`${stdout.trim()}:(OI)(CI)F`]);}}
async function restrictedOrigins(context:BrowserContext,config:CaptureConfig){const origins=new Set([new URL(config.url).origin,...(config.allowedOrigins||[]).map(o=>new URL(o).origin)]);await context.route('**/*',route=>{const u=new URL(route.request().url());return origins.has(u.origin)||['data:','blob:','about:'].includes(u.protocol)?route.continue():route.abort('blockedbyclient');});}

export async function auth(config:CaptureConfig,options:{mode?:'login'|'status'|'reset';timeoutMs?:number;localTest?:boolean}={}) {
  validateCaptureOrigins(config);
  const profile=authProfilePath(config),mode=options.mode||'login';
  if(mode==='reset'){const root=path.dirname(profile);if(path.dirname(path.resolve(profile))!==path.resolve(root))throw new Error('profile_path_invalid');await rm(profile,{recursive:true,force:true});return{schemaVersion:1,status:'passed',mode,session:'reset',profile};}
  await protectProfile(profile);
  const server=await ensureServer(config);
  let context:BrowserContext|undefined;
  try {
    context=await chromium.launchPersistentContext(profile,{...await browserLaunchOptions(mode==='status'),viewport:config.viewportCss});
    await restrictedOrigins(context,config);
    const page=context.pages()[0]||await context.newPage();
    await page.goto(config.url,{waitUntil:'domcontentloaded',timeout:30000});
    const expected=config.auth?.expectedLocator||config.readyLocator;
    if(!expected)throw new Error('auth_requires_expected_locator');
    const checkpoint={schemaVersion:1,status:'blocked',reason:'human_auth_required',mode,recording:false,screenshots:false,trace:false,har:false,profile,createdAt:new Date().toISOString()};
    await writeJson(path.join(profile,'checkpoint.json'),checkpoint);
    if(options.localTest){
      if(!['127.0.0.1','localhost','[::1]'].includes(new URL(config.url).hostname)||new URL(page.url()).pathname!=='/login')throw new Error('local_auth_test_only');
      // This fixture has no credentials. A visible button stands in for the human handoff.
      await page.getByRole('button',{name:'Войти в демо',exact:true}).click();
    }else if(mode==='login')process.stderr.write('Войдите в открытом окне; после входа продолжим с сохранённого шага.\n');
    try{await resolveLocator(page,expected).waitFor({state:'visible',timeout:mode==='status'?2000:options.timeoutMs||config.auth?.timeoutMs||180000});}
    catch{return{...checkpoint,session:'not_authenticated',resume:'demo-video auth --config <same-config>'};}
    const report={...checkpoint,status:'passed',reason:undefined,session:'authenticated',strategy:'dedicated-persistent-context',verifiedUrl:redactUrl(page.url()),localFixtureAutomation:!!options.localTest,thirdPartyLogin:'not-tested'};
    await writeJson(path.join(profile,'checkpoint.json'),report);return report;
  }finally{await context?.close();await server.stop();}
}

async function pageReady(page:Page,config:CaptureConfig){await page.goto(config.url,{waitUntil:'domcontentloaded',timeout:30000});if(config.readyLocator)await resolveLocator(page,config.readyLocator).waitFor({state:'visible',timeout:15000});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images).map(img=>img.complete?Promise.resolve():new Promise<void>(r=>{img.onload=()=>r();img.onerror=()=>r();setTimeout(r,3000)})));});}
function mediaRate(value:string){const [a,b]=value.split('/').map(Number);return a/(b||1);}
async function rawVideoSamples(file:string,filter:string):Promise<Buffer>{return new Promise((resolve,reject)=>{const child=spawn('ffmpeg',['-v','error','-i',file,'-vf',filter,'-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,shell:false});const chunks:Buffer[]=[];let err='';const timeout=setTimeout(()=>{child.kill();reject(new Error('sample_decode_timeout'))},60000);child.stdout.on('data',d=>chunks.push(d));child.stderr.on('data',d=>err+=d);child.on('error',e=>{clearTimeout(timeout);reject(e)});child.on('close',code=>{clearTimeout(timeout);code===0?resolve(Buffer.concat(chunks)):reject(new Error(err.slice(-500)));});});}
async function frameTimes(file:string){const r=await run('ffprobe',['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',file]);return JSON.parse(r.stdout).frames.map((f:any)=>Number(f.best_effort_timestamp_time)*1000) as number[];}
async function addSync(page:Page){const before=Date.now();const pageEpochMs=await page.evaluate(()=>{const el=document.createElement('div');el.id='product-demo-sync';el.setAttribute('style','position:fixed;left:0;top:0;width:64px;height:64px;background:#ff00ff;z-index:2147483647;pointer-events:none');document.documentElement.append(el);return performance.timeOrigin+performance.now();});const after=Date.now();await page.waitForTimeout(280);await page.evaluate(()=>document.getElementById('product-demo-sync')?.remove());return {pageEpochMs,nodeEpochMs:(before+after)/2,roundTripMs:after-before};}
export async function capture(config:CaptureConfig,runDir:string):Promise<any> {
  if(config.strictNativeFps)throw new Error('strict_native_fps_blocked: Playwright backend is not verified native 144 fps');
  return executeReviewedStage({config,runDir,stage:'capture',inputs:async()=>({config,source:await captureInputFingerprint(config)}),execute:review=>captureReviewed(config,runDir,hash({source:review.manifest!.sourceEvidence.map(e=>({path:e.path,sha256:e.fileSha256})),ui:review.manifest!.uiEvidence}))});
}
async function captureReviewed(config:CaptureConfig,runDir:string,reviewedSourceHash:string):Promise<any> {
  validateCaptureOrigins(config);
  if(config.strictNativeFps)throw new Error('strict_native_fps_blocked: public Playwright backend has no verified native 144 fps; inspect benchmark and explicitly select hybrid mode');
  const captureDir=path.join(runDir,'capture');await mkdir(path.join(captureDir,'clips'),{recursive:true});await mkdir(path.join(captureDir,'screenshots'),{recursive:true});
  const projectFingerprint=await captureInputFingerprint(config);
  const inputHash=hash({url:config.url,actions:config.actions,viewportCss:config.viewportCss,capturePixels:config.capturePixels,auth:config.auth,allowedOrigins:config.allowedOrigins,backend:'playwright-public-recordVideo',backendRevision:3,toolVersion:VERSION,reviewedSourceHash,projectFingerprint:projectFingerprint.digest});
  const manifestPath=path.join(captureDir,'capture-manifest.json');
  try{const prior=await readJson(manifestPath);if(projectFingerprint.complete&&prior.inputHash===inputHash&&prior.complete&&await validateCaptureCacheAssets(prior,runDir))return{...prior,cacheHit:true};}catch{}
  const server=await ensureServer(config,runDir);
  let browser:Browser|undefined,context:BrowserContext|undefined,page:Page|undefined;
  const events:any[]=[],screenshots:any[]=[];let sync:any,endSync:any,videoPath:string|undefined,failure:string|undefined,popupFailure=false;
  const clipId='clip-001',pageId='page-001';let activeEvent:any;let navIndex=0;
  try {
    const launch=await browserLaunchOptions();
    if(config.auth?.required){const report=await auth(config,{mode:'status'});if(report.status!=='passed')throw new Error('human_auth_required');}
    else{
      browser=await chromium.launch(launch);const preflight=await browser.newContext({viewport:config.viewportCss,acceptDownloads:false});
      try{await restrictedOrigins(preflight,config);const dryPage=await preflight.newPage();await pageReady(dryPage,config);await writeJson(path.join(captureDir,'preflight.json'),{schemaVersion:1,status:'passed',url:redactUrl(dryPage.url()),recording:false,screenshots:false,actionsPerformed:0});}finally{await preflight.close();}
    }
    const scale=config.capturePixels.width/config.viewportCss.width;
    if(Math.abs(scale-config.capturePixels.height/config.viewportCss.height)>0.001)throw new Error('capture_pixels_must_match_viewport_aspect');
    const contextOptions={viewport:config.viewportCss,deviceScaleFactor:scale,recordVideo:{dir:path.join(captureDir,'clips'),size:config.viewportCss},acceptDownloads:false};
    if(config.auth?.required)context=await chromium.launchPersistentContext(authProfilePath(config),{...launch,...contextOptions});
    else{browser=browser||await chromium.launch(launch);context=await browser.newContext(contextOptions);}
    await restrictedOrigins(context,config);
    await context.exposeBinding('__productDemoInput',(source,data)=>{if(source.frame===source.page.mainFrame()&&activeEvent){activeEvent.actualInputs.push({...data,nodeReceivedEpochMs:Date.now()});}});
    await context.addInitScript(()=>{for(const type of ['pointerdown','input','wheel'])document.addEventListener(type,event=>{const target=event.target instanceof Element?event.target:document.documentElement;const b=target.getBoundingClientRect();const p=event as PointerEvent;void (window as any).__productDemoInput({type,pageEpochMs:performance.timeOrigin+performance.now(),timeOrigin:performance.timeOrigin,x:Number.isFinite(p.clientX)?p.clientX:null,y:Number.isFinite(p.clientY)?p.clientY:null,boundingBox:{x:b.x,y:b.y,width:b.width,height:b.height},url:location.origin+location.pathname});},{capture:true,passive:true});});
    page=context.pages()[0]||await context.newPage();const activePage=page;
    context.on('page',async popup=>{if(popup!==activePage){popupFailure=true;await popup.close();}});
    page.on('framenavigated',frame=>{if(frame===activePage.mainFrame())navIndex++});
    await pageReady(page,config);sync=await addSync(page);await page.waitForTimeout(120);
    for(let i=0;i<config.actions.length;i++){
      const action=config.actions[i];const eventId=`event-${String(i+1).padStart(3,'0')}`;
      activeEvent={eventId,clipId,pageId,type:action.type,locator:action.locator,marker:action.name,url:redactUrl(page.url()),navigationIndex:navIndex,commandStartEpochMs:Date.now(),actualInputs:[]};
      const item=activeEvent;let loc:Locator|undefined;
      if(action.locator){loc=await uniqueLocator(page,action.locator);if(['click','fill','type','hover'].includes(action.type)){await loc.scrollIntoViewIfNeeded();item.boundingBox=await loc.boundingBox();}}
      if(action.type==='click'){if(!loc)throw new Error('click_locator_required');await loc.click();}
      else if(action.type==='fill'||action.type==='type'){if(!loc)throw new Error('input_locator_required');const sensitive=await loc.evaluate(e=>e instanceof HTMLInputElement&&(['password','email','tel'].includes(e.type)||/password|cc-|one-time|email|tel/.test(e.autocomplete)));if(sensitive||/password|парол|credit|card|секрет|token/i.test(JSON.stringify(action.locator)))throw new Error('sensitive_field_capture_forbidden');await loc.fill(action.value||'');}
      else if(action.type==='hover'){if(!loc)throw new Error('hover_locator_required');await loc.hover();}
      else if(action.type==='scroll'){await page.mouse.wheel(action.x||0,action.y||500);await page.waitForTimeout(350);}
      else if(action.type==='waitFor'){if(!loc)throw new Error('wait_locator_required');await loc.waitFor({state:'visible'});}
      else if(action.type==='pause')await page.waitForTimeout(Math.min(action.ms||0,30000));
      else if(action.type==='screenshot'){
        const id=action.name||eventId;if(!/^[\p{L}\p{N}_-]+$/u.test(id))throw new Error('invalid_screenshot_id');
        const relative=`capture/screenshots/${id}.png`,epochMs=Date.now(),url=page.url();
        await page.screenshot({path:path.join(runDir,relative),fullPage:false,animations:'disabled'});
        if(page.url()!==url)throw new Error('screenshot_navigation_race');const meta=await probe(path.join(runDir,relative));const stream=meta.streams[0];
        screenshots.push({id,name:id,sceneId:id,path:relative,eventId,clipId,pageId,epochMs,width:stream.width,height:stream.height,provenance:'real-browser-screenshot'});
      }
      if(popupFailure)throw new Error('popup_not_supported_use_single_page_scenario');
      item.commandEndEpochMs=Date.now();events.push(item);activeEvent=undefined;
    }
    endSync=await addSync(page);await page.waitForTimeout(80);videoPath=await page.video()?.path();
  }catch(e){failure=e instanceof Error&&/^[a-z0-9_: -]+$/i.test(e.message)?e.message:'capture_action_failed_details_redacted';if(page)videoPath=await page.video()?.path().catch(()=>undefined);}
  finally{await context?.close();await browser?.close();await server.stop();}
  const base={schemaVersion:1,toolVersion:VERSION,runId:path.basename(runDir),inputHash,projectFingerprint,complete:!failure,status:failure?'failed':'degraded',captureBackend:'playwright-public-recordVideo',captureTargetFps:config.captureTargetFps,observedUniqueUpdatesFps:'unknown',native144:'not-achieved',viewportCss:config.viewportCss,requestedCapturePixels:config.capturePixels,sourceCursor:'not-recorded',cursorPathProvenance:'staged-between-measured-endpoints',coordinateSystem:'viewport-css-pixels',screenshots,clips:[] as any[],eventsFile:'capture/events.jsonl',limitation:'Hybrid source. Public Playwright video fps is measured from media; encoded fps alone is not unique UI update fps.',error:failure};
  if(videoPath){
    const dest=path.join(captureDir,'clips',clipId+'.webm');if(path.resolve(videoPath)!==path.resolve(dest))await rename(videoPath,dest);
    const p=await probe(dest),v=p.streams.find((s:any)=>s.codec_type==='video'),fps=mediaRate(v.avg_frame_rate||v.r_frame_rate),durationMs=Number(p.format.duration)*1000;
    const times=await frameTimes(dest),samples=await rawVideoSamples(dest,'crop=16:16:8:8,scale=1:1');const marked=times.map((t,i)=>({t,marked:samples[i*3]>190&&samples[i*3+1]<80&&samples[i*3+2]>190})).filter(a=>a.marked).map(a=>a.t);
    const groups:number[][]=[];for(const t of marked){const prev=groups.at(-1);if(!prev||t-prev[prev.length-1]>1.6*1000/fps)groups.push([t]);else prev.push(t);}
    const first=groups[0],last=groups.at(-1);const calibrationValid=!!sync&&groups.length>=2;
    const scale=calibrationValid?(last![0]-first![0])/(endSync.pageEpochMs-sync.pageEpochMs):1;
    const offsetMs=first?first[0]-sync?.pageEpochMs*scale:0;
    const pageTime=(epochMs:number)=>epochMs*scale+offsetMs;
    const nodeToPageOffsetMs=sync?sync.pageEpochMs-sync.nodeEpochMs:0;
    const nodeTime=(epochMs:number)=>pageTime(epochMs+nodeToPageOffsetMs);
    const sourceStartMs=first?first.at(-1)!+1000/fps:0,sourceEndMs=calibrationValid&&last?last[0]:durationMs;
    const rttMs=Math.max(sync?.roundTripMs||0,endSync?.roundTripMs||0);
    const driftMs=calibrationValid?last![0]-(endSync.pageEpochMs-sync.pageEpochMs+first![0]):Infinity;
    const maximumPassedDriftMs=2*1000/fps+rttMs;
    const mappingFailure=!calibrationValid||Math.abs(driftMs)>250||Math.abs(scale-1)>0.05;
    const clockMapping={method:'affine-two-decoded-magenta-sync-anchors',status:mappingFailure?'failed':Math.abs(driftMs)>maximumPassedDriftMs?'degraded':'passed',pageEpochToMediaOffsetMs:offsetMs,pageEpochScale:scale,nodeToPageOffsetMs,uncertaintyMs:1000/fps+rttMs+Math.abs(driftMs),maximumPassedDriftMs,maximumAllowedDriftMs:250,maximumAllowedScaleDifference:0.05,interiorNonlinearDrift:'not-measured; two anchors constrain endpoints only',startSync:sync,endSync,firstMarkerSourceMs:first?.[0],lastMarkerSourceMs:last?.[0],uncorrectedEndDriftMs:Number.isFinite(driftMs)?driftMs:null};
    for(const e of events){e.sourceStartMs=nodeTime(e.commandStartEpochMs);e.sourceEndMs=nodeTime(e.commandEndEpochMs);e.sourceTimeMs=e.actualInputs[0]?.pageEpochMs?pageTime(e.actualInputs[0].pageEpochMs):e.sourceStartMs;for(const a of e.actualInputs)a.sourceTimeMs=pageTime(a.pageEpochMs);const actual=e.actualInputs.find((a:any)=>a.type==='pointerdown');if(actual){e.x=actual.x;e.y=actual.y;e.boundingBox=actual.boundingBox;e.actualActionMs=actual.sourceTimeMs;}}
    for(const s of screenshots)s.sourceTimeMs=nodeTime(s.epochMs);
    base.clips.push({id:clipId,path:`capture/clips/${clipId}.webm`,durationMs,width:v.width,height:v.height,fps,sourceStartMs,sourceEndMs,clockMapping,codec:v.codec_name,frameCount:times.length,decodedFrameTimestamps:times,provenance:'real-browser-video',uniqueUiUpdatesFps:'unknown',videoDpr:v.width/config.viewportCss.width});
    if(mappingFailure){base.complete=false;base.status='failed';base.error='clock_mapping_failed';}
  }
  for(const asset of [...base.clips,...base.screenshots])asset.sha256=await fileDigest(await safeFile(runDir,asset.path));
  await writeFile(path.join(captureDir,'events.jsonl'),events.map(e=>JSON.stringify(e)).join('\n')+'\n');await writeJson(manifestPath,base);
  if(failure)throw new Error(`capture_failed: ${failure}`);if(!base.complete)throw new Error('capture_failed: clock_mapping_failed');return base;
}

const benchmarkHtml=(title:string)=>`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>*{box-sizing:border-box}html,body{margin:0;background:#151b2c;color:white;overflow:hidden;font:24px Segoe UI}canvas{position:absolute;left:0;top:0}h1{position:absolute;top:110px;left:70px;font-size:43px}p{position:absolute;top:195px;left:70px;color:#b8c0d7}#motion{position:absolute;top:330px;width:100px;height:100px;background:#948bff;border-radius:18px}#scroll{position:absolute;top:490px;left:70px;height:150px;overflow:hidden;width:950px;color:#b8d0cc;line-height:38px}</style></head><body><canvas width="640" height="80"></canvas><h1>Product Demo · native capture benchmark</h1><p>Контроль движения, текста и независимых обновлений браузера.</p><div id="motion"></div><div id="scroll"></div><script>let n=0;window.frameLog=[];const c=document.querySelector('canvas').getContext('2d');const scroll=document.querySelector('#scroll');scroll.innerHTML=Array.from({length:100},(_,i)=>'<div>Точная геометрия · строка '+i+' · 0123456789 АБВГДЕЁ</div>').join('');function frame(t){n++;c.fillStyle='#f000f0';c.fillRect(0,0,640,80);for(let i=0;i<16;i++){c.fillStyle=(n>>i)&1?'#ffffff':'#000000';c.fillRect(16+i*32,16,24,32)}document.querySelector('#motion').style.left=(70+(Math.sin(t/800)+1)*400)+'px';scroll.scrollTop=(t/20)%1600;window.frameLog.push({id:n,epochMs:performance.timeOrigin+t});if(window.frameLog.length>10000)window.frameLog.shift();requestAnimationFrame(frame)}requestAnimationFrame(frame)</script></body></html>`;
export function analyzeMarkerFrames(ids:number[],timesMs:number[],targetFps:number){
  const pairs=ids.map((id,i)=>({id,timeMs:timesMs[i]})).filter(p=>Number.isFinite(p.timeMs)&&p.id>0);
  const valid=pairs.filter((p,i)=>!i||p.id!==pairs[i-1].id);const durationMs=(pairs.at(-1)?.timeMs||0)-(pairs[0]?.timeMs||0);
  const deltas=valid.slice(1).map((p,i)=>p.timeMs-valid[i].timeMs);const uniqueUpdatesFps=durationMs>0?(valid.length-1)*1000/durationMs:0;const expectedUpdates=durationMs/1000*targetFps;const deliveredFraction=expectedUpdates>0?(valid.length-1)/expectedUpdates:0;const maxGapMs=deltas.length?Math.max(...deltas):Infinity;
  return{status:durationMs>=2000&&deliveredFraction>=0.97&&maxGapMs<=1000/targetFps*3?'passed':'degraded',durationMs,frames:pairs.length,uniqueFrames:valid.length,duplicateFrames:pairs.length-valid.length,uniqueUpdatesFps,deliveredFraction,maxGapMs,criteria:{minimumDurationMs:2000,minimumDeliveredFraction:0.97,maxGapFrames:3},decodedMarkerIds:ids,frameTimestampsMs:timesMs};
}
async function measureMarker(file:string,targetFps:number,offset={x:0,y:0}) {
  const p=await probe(file),v=p.streams.find((s:any)=>s.codec_type==='video');const times=await frameTimes(file);
  // Each decoded sample is the centre of a 24px-wide binary cell. Thresholding
  // black/white cells rejects compression noise as a supposed new browser state.
  const raw=await rawVideoSamples(file,`crop=512:8:${16+offset.x}:${28+offset.y},scale=16:1:flags=neighbor`);
  const ids:number[]=[];for(let f=0;f<Math.floor(raw.length/48);f++){let id=0;for(let b=0;b<16;b++){const i=f*48+b*3;if((raw[i]+raw[i+1]+raw[i+2])/3>128)id|=1<<b;}ids.push(id);}
  // Ignore warmup and tail while using actual decoded timestamps.
  const start=times[0]+350,end=times.at(-1)!-150;const indexes=times.map((t,i)=>({t,i})).filter(x=>x.t>=start&&x.t<=end);
  return{...analyzeMarkerFrames(indexes.map(x=>ids[x.i]),indexes.map(x=>x.t),targetFps),width:v.width,height:v.height,encodedFps:mediaRate(v.avg_frame_rate||v.r_frame_rate),codec:v.codec_name};
}
async function findMarkerOffset(file:string):Promise<{x:number;y:number}>{
  const p=await probe(file);const {width,height}=p.streams.find((s:any)=>s.codec_type==='video');
  const buffer=await new Promise<Buffer>((resolve,reject)=>{const child=spawn('ffmpeg',['-v','error','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});const chunks:Buffer[]=[];child.stdout.on('data',d=>chunks.push(d));child.on('error',reject);child.on('close',code=>code===0?resolve(Buffer.concat(chunks)):reject(new Error('marker_decode_failed')));});
  for(let y=0;y<Math.min(height,400);y++)for(let x=0;x<Math.min(width-640,400);x++){const i=(y*width+x)*3;if(buffer[i]>200&&buffer[i+1]<70&&buffer[i+2]>200){const right=(y*width+x+630)*3;if(buffer[right]>200&&buffer[right+1]<70&&buffer[right+2]>200)return{x,y};}}
  throw new Error('native_marker_not_found');
}
export async function benchmark(options:{outputDir:string;targetFps?:number;durationSec?:number}):Promise<any>{
  const dir=path.resolve(options.outputDir),targetFps=options.targetFps||144,durationSec=Math.max(4,options.durationSec||4);await mkdir(dir,{recursive:true});
  const backends:any[]=[];const title='Product Demo Benchmark '+randomUUID().slice(0,8);
  const browser=await chromium.launch({...await browserLaunchOptions(false),args:['--start-fullscreen','--force-device-scale-factor=1','--window-position=0,0']});
  let context:BrowserContext|undefined;
  try{
    context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:path.join(dir,'playwright'),size:{width:1280,height:720}},deviceScaleFactor:1});
    const page=await context.newPage();await page.setContent(benchmarkHtml(title));await page.bringToFront();await page.waitForTimeout(1200);
    const start=Date.now();await page.waitForTimeout(durationSec*1000);const frameLog=await page.evaluate(()=>(window as any).frameLog);const pwFile=await page.video()!.path();await context.close();context=undefined;
    await writeJson(path.join(dir,'playwright-page-frames.json'),frameLog);
    const pw=await measureMarker(pwFile,targetFps);backends.push({backend:'playwright-public-recordVideo',file:pwFile,...pw,browserVersion:browser.version(),requestedCaptureFps:'public API does not expose fps control',recordedFromEpochMs:start});
    if(process.platform!=='win32')backends.push({backend:'ffmpeg-ddagrab',status:'blocked',reason:'windows_only_not_tested_on_this_os'});
    else{
      // Fullscreen controlled page protects the screen crop from browser chrome.
      context=await browser.newContext({viewport:null});const desktopPage=await context.newPage();await desktopPage.setContent(benchmarkHtml(title));await desktopPage.bringToFront();await desktopPage.evaluate(()=>document.documentElement.requestFullscreen());await desktopPage.waitForTimeout(1000);
      const geometry=await desktopPage.evaluate(()=>({screenX,screenY,innerWidth,innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio,focus:document.hasFocus()}));
      const desktopFile=path.join(dir,'ddagrab-144.mkv');
      if(!geometry.focus||geometry.innerWidth<1280||geometry.innerHeight<720||geometry.outerHeight-geometry.innerHeight>10||geometry.screenX!==0||geometry.screenY!==0){
        backends.push({backend:'ffmpeg-ddagrab',status:'blocked',reason:'safe_fullscreen_geometry_unverified',geometry});
        // Window-targeted GDI is the documented alternative when fullscreen
        // desktop geometry cannot be established. It never selects the desktop.
        try {
          const windowResult=await run('powershell',['-NoProfile','-Command',`Get-Process msedge | Where-Object { $_.MainWindowTitle -like '${title}*' } | Select-Object -First 1 -ExpandProperty MainWindowHandle`]);
          const windowHandle=windowResult.stdout.trim();if(!/^[1-9][0-9]*$/.test(windowHandle))throw new Error('dedicated_window_not_found');
          const file=path.join(dir,'gdigrab-144.mkv');
          const output=await run('ffmpeg',['-hide_banner','-y','-f','gdigrab','-draw_mouse','0','-framerate',String(targetFps),'-i',`hwnd=${windowHandle}`,'-t',String(durationSec),'-c:v','ffv1','-level','3','-threads','4','-fps_mode','passthrough',file],{timeoutMs:45000});
          await writeFile(path.join(dir,'gdigrab-ffmpeg.log'),output.stderr);const offset=await findMarkerOffset(file);const measured=await measureMarker(file,targetFps,offset);
          await writeJson(path.join(dir,'gdigrab-page-frames.json'),await desktopPage.evaluate(()=>(window as any).frameLog));
          backends.push({backend:'ffmpeg-gdigrab-window',...measured,file,geometry,markerOffset:offset,safeRegion:'dedicated demo browser window only; no desktop',limitation:'Window capture includes dedicated browser chrome; not a production capture preset'});
        }catch(e){backends.push({backend:'ffmpeg-gdigrab-window',status:'blocked',reason:e instanceof Error?e.message:'backend_failed',geometry,file:path.join(dir,'gdigrab-144.mkv')});}
        // If fullscreen is unavailable, establish a crop inside this particular
        // browser's physical client rectangle using Win32, never guessed DPI.
        try{
          const script=`Add-Type @'
using System; using System.Runtime.InteropServices;
public class PDWindow { [StructLayout(LayoutKind.Sequential)] public struct R { public int L,T,Ri,B; } [StructLayout(LayoutKind.Sequential)] public struct P { public int X,Y; }
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out R r); [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref P p); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
'@
[PDWindow]::SetProcessDPIAware() | Out-Null
$p=Get-Process msedge,chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '${title}*' } | Select-Object -First 1
if(!$p){throw 'dedicated_window_not_found'}
$r=New-Object PDWindow+R; $pt=New-Object PDWindow+P
[PDWindow]::GetClientRect($p.MainWindowHandle,[ref]$r) | Out-Null
[PDWindow]::ClientToScreen($p.MainWindowHandle,[ref]$pt) | Out-Null
@{x=$pt.X;y=$pt.Y;width=$r.Ri;height=$r.B;foreground=([PDWindow]::GetForegroundWindow() -eq $p.MainWindowHandle)} | ConvertTo-Json -Compress`;
          const win=JSON.parse((await run('powershell',['-NoProfile','-Command',script])).stdout);
          await writeJson(path.join(dir,'desktop-safety-check.json'),{schemaVersion:1,...win,cropRequired:{width:1420,height:990},status:win.foreground&&win.width>=1420&&win.height>=990?'passed':'blocked'});
          if(!win.foreground||win.width<1420||win.height<990)throw new Error('safe_client_crop_not_available');
          await desktopPage.evaluate(()=>{const c=document.querySelector('canvas')!;c.style.left='160px';c.style.top='240px';c.style.zIndex='10';});await desktopPage.waitForTimeout(300);
          const crop={x:win.x+128,y:win.y+256,width:1280,height:720};
          const file=path.join(dir,'ddagrab-window-crop-144.mkv');
          const output=await run('ffmpeg',['-hide_banner','-y','-f','lavfi','-i',`ddagrab=framerate=${targetFps}:dup_frames=0:draw_mouse=0:video_size=${crop.width}x${crop.height}:offset_x=${crop.x}:offset_y=${crop.y}`,'-t',String(durationSec),'-vf','hwdownload,format=bgra','-c:v','ffv1','-level','3','-threads','4','-fps_mode','passthrough',file],{timeoutMs:45000});
          const after=JSON.parse((await run('powershell',['-NoProfile','-Command',script])).stdout);if(!after.foreground||after.x!==win.x||after.y!==win.y)throw new Error('capture_foreground_or_geometry_changed');
          const offset=await findMarkerOffset(file),measured=await measureMarker(file,targetFps,offset);await writeFile(path.join(dir,'ddagrab-crop-ffmpeg.log'),output.stderr);await writeJson(path.join(dir,'ddagrab-crop-page-frames.json'),await desktopPage.evaluate(()=>(window as any).frameLog));
          backends.push({backend:'ffmpeg-ddagrab-client-crop',...measured,file,safeRegion:crop,windowGeometry:win,markerOffset:offset,dupFrames:false,displayRefreshHz:'read separately by doctor',limitation:'1280x720 physical crop inside dedicated foreground demo browser; does not certify QHD native capture'});
        }catch(e){backends.push({backend:'ffmpeg-ddagrab-client-crop',status:'blocked',reason:e instanceof Error?e.message:'backend_failed',geometry});}
      }
      else{try{
        const output=await run('ffmpeg',['-hide_banner','-y','-f','lavfi','-i',`ddagrab=framerate=${targetFps}:dup_frames=0:draw_mouse=0:video_size=1280x720:offset_x=0:offset_y=0`,'-t',String(durationSec),'-vf','hwdownload,format=bgra','-c:v','ffv1','-level','3','-threads','4','-fps_mode','passthrough',desktopFile],{timeoutMs:45000});
        const frameLog=await desktopPage.evaluate(()=>(window as any).frameLog);await writeJson(path.join(dir,'ddagrab-page-frames.json'),frameLog);
        const measured=await measureMarker(desktopFile,targetFps);const focusedAfter=await desktopPage.evaluate(()=>document.hasFocus());
        backends.push({backend:'ffmpeg-ddagrab',...measured,status:focusedAfter?measured.status:'failed',geometry,file:desktopFile,focusAfter:focusedAfter,safeRegion:{x:0,y:0,width:1280,height:720},dupFrames:false,displayRefreshHz:'read separately by doctor',limitation:'1280x720 crop benchmark; does not certify QHD native capture'});await writeFile(path.join(dir,'ddagrab-ffmpeg.log'),output.stderr);
      }catch(e){backends.push({backend:'ffmpeg-ddagrab',status:'blocked',reason:e instanceof Error?e.message:'backend_failed',geometry});}}
    }
  }finally{await context?.close();await browser.close();}
  const report={schemaVersion:1,createdAt:new Date().toISOString(),toolVersion:VERSION,targetFps,status:backends.some(b=>b.status==='passed')?'passed':'degraded',native144:backends.some(b=>b.status==='passed')?'passed-at-tested-resolution':'not-achieved',method:'16-bit visual frame counter changes once per requestAnimationFrame; decoded cell brightness with timestamps; compression differences alone never count',backends};
  await writeJson(path.join(dir,'benchmark-report.json'),report);return report;
}
