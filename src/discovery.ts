import {spawn, type ChildProcess} from 'node:child_process';
import {readFile,writeFile,mkdir,access,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {DemoConfig} from './schema.js';

export interface StartSpec {command:string;args:string[];cwd?:string;timeoutMs?:number}
export async function discoverProject(project:string) {
  const root=path.resolve(project);
  const files:Record<string,string>={};
  for(const name of ['AGENTS.md','README.md','package.json','pnpm-workspace.yaml','vite.config.ts','next.config.js','next.config.ts']) {
    try {const s=await readFile(path.join(root,name),'utf8');files[name]=s.slice(0,24000);}catch{}
  }
  let pkg:any={};try{pkg=JSON.parse(files['package.json']||'{}');}catch{}
  const lockfiles=[];for(const name of ['package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lockb']) {try{await access(path.join(root,name));lockfiles.push(name);}catch{}}
  return {schemaVersion:1,project:root,files,scripts:pkg.scripts||{},workspaces:pkg.workspaces||[],lockfiles,decision:pkg.scripts?.dev?'Review dev script before launching':pkg.scripts?.start?'Review start script before launching':'No inferred start command; use explicit config or bundled example',contentIsUntrusted:true};
}
export async function waitForHttp(url:string,timeoutMs=30000) {
  const deadline=Date.now()+timeoutMs;
  do {try{const r=await fetch(url,{signal:AbortSignal.timeout(1500),redirect:'manual'});if(r.status>=200&&r.status<400)return true;}catch{} await new Promise(r=>setTimeout(r,200));}while(Date.now()<deadline);
  return false;
}
export async function ensureServer(config:{url:string;project?:string;start?:StartSpec},runDir?:string) {
  if(await waitForHttp(config.url,250))return {url:config.url,owned:false,pid:undefined,stop:async()=>{}};
  if(!config.start)throw new Error('server_not_ready: configure start.command and start.args or start the application');
  const s=config.start;
  if(typeof s.command!=='string'||!Array.isArray(s.args)||s.args.some(a=>typeof a!=='string'))throw new Error('start_requires_command_and_argument_array');
  // No shell is used. On Windows use node + npm-cli.js for trusted npm scripts.
  const child=spawn(s.command,s.args,{cwd:path.resolve(s.cwd||config.project||process.cwd()),windowsHide:true,stdio:['ignore','ignore','ignore'],shell:false});
  let launchError=false;child.once('error',()=>{launchError=true;});
  const stop=async()=>{
    if(!child.pid||child.exitCode!==null)return;
    if(process.platform==='win32'){
      // Only the process tree rooted at this launch's live PID is targeted.
      await new Promise<void>(resolve=>{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});const timer=setTimeout(()=>{killer.kill();resolve()},5000);killer.once('error',()=>{clearTimeout(timer);child.kill();resolve()});killer.once('exit',()=>{clearTimeout(timer);resolve()});});
    }else child.kill('SIGTERM');
  };
  if(!await waitForHttp(config.url,s.timeoutMs||30000)||launchError){await stop();throw new Error('managed_server_failed_to_become_ready');}
  if(runDir){await mkdir(path.join(runDir,'logs'),{recursive:true});await writeFile(path.join(runDir,'logs','server.json'),JSON.stringify({owned:true,pid:child.pid,startedAt:new Date().toISOString(),url:new URL(config.url).origin},null,2));}
  return {url:config.url,owned:true,pid:child.pid,stop};
}
export async function installExampleSite(project:string,variant:'basic'|'second') {
  const dir=path.join(project,'demo-site');
  const name=variant==='second'?'second-web':'basic-web';
  for(const file of ['server.mjs',name+'/index.html']) {
    const target=path.join(dir,file);
    await mkdir(path.dirname(target),{recursive:true});
    await copyFile(fileURLToPath(new URL('../examples/'+file,import.meta.url)),target,1);
  }
  return dir;
}
export function makeExampleConfig(project:string,variant:'basic'|'second'='basic',port=4173,localExample=false):DemoConfig {
  const second=variant==='second'; const url=`http://127.0.0.1:${port}`;
  const pause=(ms:number)=>({type:'pause' as const,ms});
  const shot=(name:string)=>({type:'screenshot' as const,name});
  return {schemaVersion:1,project:path.resolve(project),url,allowedOrigins:[url],start:{command:process.execPath,args:[localExample?path.join(path.resolve(project),'demo-site/server.mjs'):fileURLToPath(new URL('../examples/server.mjs',import.meta.url)),'--port',String(port),...(second?['--second']:[])]},viewportCss:{width:1600,height:900},capturePixels:{width:2560,height:1440},captureTargetFps:144,durationSec:3,language:'ru-RU',voice:'female',ttsProvider:'auto',allowExternalTts:false,speechRatePercent:0,presentation:'cinematic',profile:'web-60',strictNativeFps:false,readyLocator:{testid:second?'home':'dashboard'},brand:{name:second?'Форма':'Орбита',accent:second?'#455e41':'#645de7'},
    actions:second?[pause(600),shot('overview'),{type:'click',locator:{role:'link',name:'Открыть библиотеку →'}},{type:'waitFor',locator:{testid:'library'}},pause(700),shot('library'),{type:'click',locator:{role:'button',name:'＋ Создать подборку'}},{type:'fill',locator:{label:'Название подборки'},value:'Свежий взгляд'},pause(600),{type:'click',locator:{role:'button',name:'Сохранить подборку'}},{type:'waitFor',locator:{testid:'collection-result'}},pause(1200),shot('result'),pause(800)]:[pause(600),shot('overview'),{type:'click',locator:{role:'button',name:'＋ Создать проект'}},{type:'fill',locator:{label:'Название проекта'},value:'Запуск продукта'},pause(900),shot('create'),{type:'click',locator:{role:'button',name:'Создать'}},{type:'waitFor',locator:{testid:'created-project'}},pause(1200),shot('result'),pause(800)],
    storyboard:{schemaVersion:1,title:second?'Форма — сохраните вдохновение':'Орбита — от идеи к проекту',scenes:second?[
      {sceneId:'overview',meaning:'Обозначить создание новой подборки',visibleResult:'Главная страница',displayText:'Идеям нужно место',spokenText:'Сохраним идеи в новой подборке.',screenshotId:'overview',sourceKind:'screenshot',layout:'hero',durationSec:4,eventIds:[]},
      {sceneId:'library',meaning:'Показать переход, ввод названия и сохранение',visibleResult:'Подборка «Свежий взгляд» сохранена',displayText:'Соберите свою историю',spokenText:'Откроем библиотеку, назовём подборку и сохраним её.',screenshotId:'library',sourceKind:'video',clipId:'clip-001',layout:'product',eventIds:['event-003','event-007','event-010']},
      {sceneId:'result',meaning:'Подтвердить сохранение',visibleResult:'Подборка сохранена',displayText:'Вдохновение сохранено',spokenText:'Подборка «Свежий взгляд» сохранена.',screenshotId:'result',sourceKind:'screenshot',layout:'outro',durationSec:4,eventIds:[]}
    ]:[
      {sceneId:'overview',meaning:'Обозначить создание нового проекта',visibleResult:'Обзор проектов открыт',displayText:'От идеи — к проекту',spokenText:'Создадим проект в Орбите.',screenshotId:'overview',sourceKind:'screenshot',layout:'hero',durationSec:4,eventIds:[]},
      {sceneId:'create',meaning:'Показать ввод названия и создание проекта',visibleResult:'Карточка проекта создана',displayText:'Дайте идее имя',spokenText:'Откроем форму, зададим название и создадим проект.',screenshotId:'create',sourceKind:'video',clipId:'clip-001',layout:'product',eventIds:['event-003','event-007']},
      {sceneId:'result',meaning:'Подтвердить результат',visibleResult:'Карточка проекта создана',displayText:'Можно начинать',spokenText:'Проект «Запуск продукта» создан.',screenshotId:'result',sourceKind:'screenshot',layout:'outro',durationSec:4,eventIds:[]}
    ]}}
}
