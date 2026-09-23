import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {CaptureManifestSchema,DemoConfigSchema,EditPlanSchema,NarrationManifestSchema,StoryboardSchema,profiles,RenderProfileSchema,type EditPlan} from './schema.js';
import {readJson,writeJson,VERSION} from './util.js';
import {msToFrame,mapEvent} from './time.js';

const ceilFrames=(ms:number,fps:number)=>Math.ceil(ms*fps/1000-1e-8);
function uniqueIds(items:{id:string}[],label:string){
 const ids=new Set<string>();
 for(const item of items){if(ids.has(item.id))throw new Error(`Ambiguous ${label} ID: ${item.id}`);ids.add(item.id);}
}

export async function planRun(runDir:string,profileName?:string){
 const cfg=DemoConfigSchema.parse(await readJson(path.join(runDir,'resolved-config.json')));
 const story=StoryboardSchema.parse(await readJson(path.join(runDir,'storyboard.json')));
 const cap=CaptureManifestSchema.parse(await readJson(path.join(runDir,'capture/capture-manifest.json')));
 const voice=NarrationManifestSchema.parse(await readJson(path.join(runDir,'narration/narration-manifest.json')));
 const profile=RenderProfileSchema.parse((profileName??cfg.profile)==='custom'?cfg.customProfile:profiles[profileName??cfg.profile]);
 const fps=profile.fps;
 const events=(await readFile(path.join(runDir,'capture/events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
 uniqueIds(cap.screenshots,'screenshot');uniqueIds(cap.clips,'clip');
 uniqueIds(story.scenes.map(s=>({id:s.sceneId})),'scene');
 uniqueIds(events.filter(e=>typeof e.eventId==='string').map(e=>({id:e.eventId})),'event');
 let end=0;
 const scenes=story.scenes.map((s,i)=>{
  if(s.sourceScreenshot)throw new Error(`Scene ${s.sceneId}: use screenshotId from the capture manifest instead of sourceScreenshot`);
  if(s.sourceKind==='screenshot'&&s.clipId)throw new Error(`Scene ${s.sceneId}: screenshot source conflicts with clipId`);
  const isVideo=s.sourceKind==='video'||!!s.clipId;
  if(isVideo&&!s.clipId)throw new Error(`Scene ${s.sceneId}: video requires an explicit clipId from the capture manifest`);
  const shot=cap.screenshots.find(v=>v.id===(s.screenshotId??s.sceneId));
  if(s.screenshotId&&!shot)throw new Error(`Scene ${s.sceneId}: requested screenshot ID not found: ${s.screenshotId}`);
  const clip=isVideo?cap.clips.find(v=>v.id===s.clipId):undefined;
  if(isVideo&&!clip)throw new Error(`Scene ${s.sceneId}: requested clip ID not found: ${s.clipId}`);
  if(!isVideo&&!shot)throw new Error(`Scene ${s.sceneId}: screenshot ID not found: ${s.screenshotId??s.sceneId}; select an explicit captured source`);
  const source=clip??shot!;
  const start=clip?(s.sourceStartMs??Number(clip.sourceStartMs??0)):0;
  const finish=clip?(s.sourceEndMs??Number(clip.sourceEndMs??clip.durationMs)):1;
  if(!Number.isFinite(start)||!Number.isFinite(finish)||start<0||finish<=start||(clip&&finish>clip.durationMs+1))throw new Error(`Scene ${s.sceneId}: source range ${start}–${finish} ms is outside the selected clip`);
  const playbackRate=s.playbackRate??1;
  const segment=voice.segments.find(n=>n.sceneId===s.sceneId);
  const voiceMinimumMs=segment?segment.durationMs+250:0;
  const clipMinimumMs=clip?(finish-start)/playbackRate:0;
  const minimumMs=Math.max(500,voiceMinimumMs,clipMinimumMs);
  // Explicit shot durations are editorial decisions. Never stretch every shot to fill a target.
  const requestedMs=s.durationSec===undefined?Math.max(3500,voiceMinimumMs+(segment?450:0),clipMinimumMs+(clip?300:0)):s.durationSec*1000;
  const frames=msToFrame(requestedMs,fps);
  if(frames<ceilFrames(minimumMs,fps))throw new Error(`Scene ${s.sceneId}: duration ${s.durationSec} s is too short; selected footage and narration need at least ${(ceilFrames(minimumMs,fps)/fps).toFixed(3)} s. Trim the source, shorten narration, or explicitly extend this scene.`);
  const outputStartFrame=end;end+=frames;
  const camera=s.camera?s.camera.map(k=>({frame:Math.round(k.at*(frames-1)),scale:k.scale,x:k.x,y:k.y})):[{frame:0,scale:1,x:.5,y:.5}];
  if(camera.some((k,j,a)=>j>0&&k.frame<=a[j-1].frame))throw new Error(`Scene ${s.sceneId}: camera cues collide after rounding to ${fps} fps; separate cue times or remove redundant cues`);
  const scene:EditPlan['scenes'][number]={sceneId:s.sceneId,kind:clip?'video':'screenshot',sourcePath:source.path,sourcePixels:{width:source.width,height:source.height},clipId:clip?.id,sourceStartMs:start,sourceEndMs:finish,sourceDurationMs:clip?.durationMs??1,outputStartFrame,outputDurationFrames:frames,playbackRate,eyebrow:s.eyebrow,layout:s.layout??'product',voicePath:segment?.path,voiceDurationMs:segment?.durationMs??0,title:s.displayText,caption:s.spokenText,camera,events:[]};
  const selected=s.eventIds.map(id=>{
   const event=events.find(e=>e.eventId===id);
   if(!event)throw new Error(`Scene ${s.sceneId}: requested event ID not found: ${id}`);
   if(clip&&event.clipId!==clip.id)throw new Error(`Scene ${s.sceneId}: event ${id} belongs to another clip`);
   return event;
  });
  if(new Set(s.eventIds).size!==s.eventIds.length)throw new Error(`Scene ${s.sceneId}: duplicate event IDs`);
  if(clip)scene.events=selected.filter(e=>e.type==='click').map(e=>{
   const t=e.actualActionMs??e.actionTimeMs??e.sourceTimeMs??e.pointerDownMs;
   if(!Number.isFinite(t)||t<start||t>=finish)throw new Error(`Scene ${s.sceneId}: selected click ${e.eventId} is outside the source range or lacks measured timing`);
   const mapped=mapEvent(t,scene,fps)!-outputStartFrame;
   const point=e.point??e.coordinates??(Number.isFinite(e.x)?{x:e.x,y:e.y}:null)??(e.boundingBox?{x:e.boundingBox.x+e.boundingBox.width/2,y:e.boundingBox.y+e.boundingBox.height/2}:null);
   if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new Error(`Scene ${s.sceneId}: selected click ${e.eventId} lacks measured coordinates`);
   return{frame:Math.min(frames-1,mapped),x:point.x/cfg.viewportCss.width,y:point.y/cfg.viewportCss.height,type:'click',provenance:'staged-between-measured-endpoints' as const};
  }).sort((a,b)=>a.frame-b.frame);
  return scene;
 });
 const requiredFrames=Math.max(ceilFrames(cfg.durationSec*1000,fps),ceilFrames(voice.fullTrack?.durationMs??0,fps));
 if(end<requiredFrames)throw new Error(`Storyboard totals ${(end/fps).toFixed(3)} s, below the requested minimum ${(requiredFrames/fps).toFixed(3)} s (durationSec/full narration). Author scene durations or revise durationSec deliberately; automatic padding is disabled.`);
 const plan=EditPlanSchema.parse({schemaVersion:1,runId:path.basename(runDir),toolVersion:VERSION,profile,durationFrames:end,transitionFrames:0,presentation:cfg.presentation,brandName:cfg.brand.name,title:story.title,accent:cfg.brand.accent,viewportCss:cfg.viewportCss,sourcePixels:cfg.capturePixels,scenes,fullTrack:voice.fullTrack?.path,fullTrackDurationMs:voice.fullTrack?.durationMs,provenance:['Explicit source IDs and measured per-scene pixels; video holds retain the final video frame.','Recorded action clips retain measured capture fps; render fps does not add source states.','Only selected measured click events are staged; segment captions, no word alignment.','Scene durations are authored without automatic padding; camera is static unless explicitly planned.']});
 await writeJson(path.join(runDir,`edit-plan-${profile.name}.json`),plan);await writeJson(path.join(runDir,'edit-plan.json'),plan);await subtitles(runDir,plan);return plan;
}
async function subtitles(runDir:string,p:EditPlan){await mkdir(path.join(runDir,'subtitles'),{recursive:true});const tc=(ms:number,sep:string)=>new Date(Math.round(ms)).toISOString().slice(11,23).replace('.',sep);const parts=p.scenes.filter(s=>s.voicePath).map((s,i)=>{const start=s.outputStartFrame/p.profile.fps*1000+250;return {i:i+1,start,end:start+s.voiceDurationMs,text:s.caption};});await writeFile(path.join(runDir,'subtitles/ru.srt'),parts.map(s=>`${s.i}\n${tc(s.start,',')} --> ${tc(s.end,',')}\n${s.text}\n`).join('\n'));await writeFile(path.join(runDir,'subtitles/ru.vtt'),'WEBVTT\n\n'+parts.map(s=>`${tc(s.start,'.')} --> ${tc(s.end,'.')}\n${s.text}\n`).join('\n'));}
