import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {capture,auth,authProfilePath} from '../src/capture.js';
import {makeExampleConfig} from '../src/discovery.js';
import {writeJson} from '../src/util.js';
import {createUnderstandingDraft,assertUnderstanding,type UnderstandingManifest} from '../src/understanding.js';

const root=process.cwd();const checks:any[]=[];
// This review applies only to these exact, already-read bundled fixtures. It is
// deliberately private to this test and fails when source behavior changes.
async function reviewedFixture(kind:'basic'|'second'|'protected'){
  const second=kind==='second',port=second?4184:kind==='protected'?4185:4183;
  const config=makeExampleConfig(root,second?'second':'basic',port);
  assert.equal(config.url,`http://127.0.0.1:${port}`);
  assert.deepEqual(config.start,{command:process.execPath,args:[path.join(root,'examples','server.mjs'),'--port',String(port),...(second?['--second']:[])]});
  assert.deepEqual(config.actions.filter(a=>!['pause','screenshot'].includes(a.type)),second?[
    {type:'click',locator:{role:'link',name:'Открыть библиотеку →'}},{type:'waitFor',locator:{testid:'library'}},
    {type:'click',locator:{role:'button',name:'＋ Создать подборку'}},{type:'fill',locator:{label:'Название подборки'},value:'Свежий взгляд'},
    {type:'click',locator:{role:'button',name:'Сохранить подборку'}},{type:'waitFor',locator:{testid:'collection-result'}}
  ]:[
    {type:'click',locator:{role:'button',name:'＋ Создать проект'}},{type:'fill',locator:{label:'Название проекта'},value:'Запуск продукта'},
    {type:'click',locator:{role:'button',name:'Создать'}},{type:'waitFor',locator:{testid:'created-project'}}
  ]);
  if(kind==='protected'){config.url+='/protected';config.auth={required:true,expectedLocator:{testid:'dashboard'}};}
  config.analysisFile=`output/capture-integration-${kind}.understanding.json`;
  const html=second?'examples/second-web/index.html':'examples/basic-web/index.html';
  const draft=await createUnderstandingDraft({project:root,config,sourceRequests:[{path:'examples/server.mjs'},{path:html}]});
  const reviewedSourceHashes:Record<string,string>={
    'examples/server.mjs':'71d52c1d5a9333a00b0b47dafb7b716b4cc74f65500bc26eb921288f4005734e',
    'examples/basic-web/index.html':'4d81d72d016f269c4406b65775185860937db88c35caa0b69df8a87a828e5bc0',
    'examples/second-web/index.html':'4ecd80eb14325f647f9e0a9eca2033ef0bae9d269a9f27e6d5790d2d05d98379'
  };
  for(const reading of draft.readings){
    assert.equal(reading.endLine,reading.totalLines,'Fixture review must cover the entire source file');
    assert.equal(createHash('sha256').update(reading.content).digest('hex'),reviewedSourceHashes[reading.path],`Fixture source changed: reread ${reading.path} and revise this specific test review before updating its hash`);
  }
  const manifest:UnderstandingManifest={...draft.manifest,status:'ready',authoredBy:'Bundled fixture integration review',
    product:second?{
      name:'Форма — локальный пример',purpose:'Локальный макет показывает переход в библиотеку и создание визуального результата с названием подборки.',
      audience:'Разработчики, проверяющие реальную запись второго интерфейса',primaryOutcome:'После отправки формы в текущем DOM появляется блок collection-result с введённым названием.'
    }:{
      name:'Орбита — локальный пример',purpose:'Локальный макет обзора проектов открывает форму и после задержки добавляет карточку с введённым названием.',
      audience:'Разработчики, проверяющие запись модального сценария',primaryOutcome:'Карточка created-project появляется первой в обзоре; счётчик меняется на четыре и появляется статус.'
    },
    safeStart:{...draft.manifest.safeStart,explanation:'Прочитанный сервер Node слушает только 127.0.0.1, отдаёт выбранный HTML без внешних запросов и запускается прямым argv. POST /demo-login задаёт только фиктивную cookie для локального теста.',evidenceIds:['source-001']},
    flow:second?[
      {id:'library',summary:'Ссылка загружает /library; скрипт меняет testid главного блока и создаёт кнопку новой подборки.',actionIndexes:[2,3],evidenceIds:['source-001','source-002'],success:{description:'Видна библиотека с доступной кнопкой создания подборки.',locator:{testid:'library'}}},
      {id:'name',summary:'Кнопка открывает dialog; поле получает демонстрационное название без отправки на сервер.',actionIndexes:[6,7],evidenceIds:['source-002'],success:{description:'В открытом диалоге видно поле названия подборки.',locator:{label:'Название подборки'}}},
      {id:'result',summary:'Обработчик формы закрывает dialog и вставляет результат с введённым названием после hero.',actionIndexes:[9,10],evidenceIds:['source-002'],success:{description:'В текущей странице виден новый блок результата подборки.',locator:{testid:'collection-result'}}}
    ]:[
      {id:'name',summary:'Кнопка открывает dialog, после чего поле получает название демонстрационного проекта.',actionIndexes:[2,3],evidenceIds:['source-002'],success:{description:'В открытом диалоге видно поле названия проекта.',locator:{label:'Название проекта'}}},
      {id:'result',summary:'Отправка формы запускает задержку 1200 мс; обработчик вставляет новую карточку, меняет счётчик и закрывает dialog.',actionIndexes:[6,7],evidenceIds:['source-002'],success:{description:'В начале списка видна созданная карточка проекта.',locator:{testid:'created-project'}}}
    ],
    limitations:[
      'Оба интерфейса являются локальными демонстрационными макетами. Созданные проекты и подборки существуют только в DOM и исчезают после перезагрузки; сервер не хранит их.',
      ...(kind==='protected'?['Авторизация — только локальная фикстура: POST /demo-login выдаёт демонстрационную cookie без почты и пароля. Внешние аккаунты и реальная аутентификация не проверяются.']:[])
    ]
  };
  await writeJson(path.join(root,config.analysisFile),manifest);
  await assertUnderstanding({project:root,config,manifestPath:config.analysisFile});
  return config;
}

const basicConfig=await reviewedFixture('basic'),secondConfig=await reviewedFixture('second'),authConfig=await reviewedFixture('protected');
// Cheap fixture-maintenance check; no browser, server, authentication or capture.
if(process.argv.includes('--validate-fixtures-only')){console.log(JSON.stringify({status:'passed',reviewedFixtures:['basic','second','protected'],capture:'not-run'}));process.exit(0);}
const basicDir=path.join(root,'output','capture-integration-basic');
const basic=await capture(basicConfig,basicDir);assert.equal(basic.complete,true);assert.equal(basic.screenshots[0].width,2560);checks.push({name:'basic-real-capture',status:'passed',path:basicDir,sourcePixels:'1600x900',encodedFps:basic.clips[0].fps,screenshotPixels:'2560x1440'});
const before=(await stat(path.join(basicDir,basic.clips[0].path))).mtimeMs;const changed=structuredClone(basicConfig);changed.voice='male';changed.storyboard.scenes[0].spokenText='Другая озвучка без повторной записи.';const cached=await capture(changed,basicDir);assert.equal(cached.cacheHit,true);assert.equal((await stat(path.join(basicDir,basic.clips[0].path))).mtimeMs,before);checks.push({name:'voice-text-change-reuses-capture',status:'passed'});
const events=(await readFile(path.join(basicDir,'capture/events.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));const clicks=events.filter(e=>e.type==='click');assert.equal(clicks.length,2);assert.ok(clicks.every(e=>e.actualInputs.some((a:any)=>a.type==='pointerdown')&&Number.isFinite(e.actualActionMs)));assert.ok(events.every(e=>!('value'in e)));checks.push({name:'actual-pointerdown-and-redacted-values',status:'passed'});
const secondDir=path.join(root,'output','capture-integration-second');const second=await capture(secondConfig,secondDir);assert.equal(second.complete,true);assert.equal(second.screenshots[1].id,'library');checks.push({name:'second-layout-real-navigation-modal-result',status:'passed',path:secondDir});
await auth(authConfig,{mode:'reset'});const blocked=await auth(authConfig,{mode:'status'});assert.equal(blocked.status,'blocked');const login=await auth(authConfig,{mode:'login',localTest:true,timeoutMs:10000});assert.equal(login.status,'passed');assert.ok('recording' in login);assert.ok('screenshots' in login);assert.equal(login.recording,false);assert.equal(login.screenshots,false);const resumed=await auth(authConfig,{mode:'status'});assert.equal(resumed.status,'passed');const protectedDir=path.join(root,'output','capture-integration-protected');const authenticated=await capture(authConfig,protectedDir);assert.equal(authenticated.complete,true);checks.push({name:'headed-auth-checkpoint-resume-and-post-auth-record',status:'passed',profile:authProfilePath(authConfig),thirdPartyAuth:'not-tested',handoffActor:'automated local fixture button; no credentials',path:protectedDir});
const report={schemaVersion:1,status:'passed',checks};await writeJson(path.join(root,'output','capture-integration-report.json'),report);console.log(JSON.stringify(report,null,2));
