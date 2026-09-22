import React from 'react';
import {AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {EditPlan} from '../schema.js';

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const asset=(value:string)=>staticFile(value.replaceAll('\\','/'));
const ease=Easing.inOut(Easing.cubic);

/** Source coordinates stay normalized through an explicit cover crop and camera transform. */
export function CinematicScene({scene,plan,index}:{scene:EditPlan['scenes'][0];plan:EditPlan;index:number}) {
  const frame=useCurrentFrame();
  const {width:w,height:h,fps}=useVideoConfig();
  const portrait=h>w;
  const hero=scene.layout==='hero'&&!portrait;
  const outro=scene.layout==='outro'&&!portrait;
  const split=hero||outro;
  const enter=spring({frame,fps,config:{damping:200,stiffness:100,mass:1,overshootClamping:true},durationInFrames:Math.round(fps*.8)});
  const fade=index===0?1:interpolate(frame,[0,Math.max(1,plan.transitionFrames)],[0,1],{extrapolateRight:'clamp'});
  const box={x:w*(split?.415:.055),y:h*(portrait?.29:split?.205:.19),width:w*(split?.56:.89),height:h*(portrait?.43:split?.59:.67)};
  const ratio=plan.sourcePixels.width/plan.sourcePixels.height;
  if(hero){box.height=box.width/ratio;box.y=h*.225;}
  // Portrait preserves the complete source aspect ratio instead of blindly cropping a desktop UI.
  if(portrait){box.height=box.width/ratio;box.y=h*.33;}
  const baseW=Math.max(box.width,box.height*ratio),baseH=baseW/ratio;
  const keys=scene.camera;
  const sample=(field:'scale'|'x'|'y')=>keys.length===1?keys[0][field]:interpolate(frame,keys.map(k=>k.frame),keys.map(k=>k[field]),{easing:ease,extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const scale=sample('scale'),cx=sample('x'),cy=sample('y');
  const tx=clamp(box.width/2-cx*baseW*scale,box.width-baseW*scale,0);
  const ty=clamp(box.height/2-cy*baseH*scale,box.height-baseH*scale,0);
  const past=scene.events.filter(e=>e.frame<=frame).at(-1),next=scene.events.find(e=>e.frame>frame);
  let px=past?.x??next?.x??.5,py=past?.y??next?.y??.5;
  if(past&&next){const t=interpolate(frame,[Math.max(past.frame,next.frame-fps*.65),next.frame],[0,1],{easing:ease,extrapolateLeft:'clamp',extrapolateRight:'clamp'});px=past.x+(next.x-past.x)*t;py=past.y+(next.y-past.y)*t;}
  // Cursor starts close to the first measured endpoint; the move itself is editorially staged.
  if(!past&&next){const t=interpolate(frame,[Math.max(0,next.frame-fps*.65),next.frame],[0,1],{easing:ease,extrapolateLeft:'clamp',extrapolateRight:'clamp'});px=next.x-.035*(1-t);py=next.y+.055*(1-t);}
  const lastClick=scene.events.at(-1)?.frame??0;
  const cursorOpacity=interpolate(frame,[lastClick+fps*.6,lastClick+fps*1.05],[1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const videoFrames=Math.floor((scene.sourceEndMs-scene.sourceStartMs)/1000*fps/scene.playbackRate);
  const subtitleOn=frame>=Math.round(fps*.20)&&frame<Math.round(fps*(scene.voiceDurationMs/1000+.48));
  const font="'Segoe UI', Arial, sans-serif";
  return <AbsoluteFill style={{opacity:fade,fontFamily:font,background:'#11141d',color:'#f7f7fa',overflow:'hidden'}}>
    <AbsoluteFill style={{background:split?'radial-gradient(ellipse at 85% 42%, #403668 0%, #1d2032 32%, #11141d 70%)':'radial-gradient(ellipse at 50% 65%, #343047 0%, #171b27 55%, #11141d 100%)'}}/>
    <div style={{position:'absolute',left:w*.055,top:h*.052,display:'flex',gap:w*.008,alignItems:'center',fontSize:w*(portrait?.032:.016),fontWeight:650,letterSpacing:'-.02em'}}>
      <span style={{width:w*.015,height:w*.015,borderRadius:w*.005,background:plan.accent,transform:'rotate(-12deg)'}}/>{plan.brandName??plan.title}
    </div>
    <div style={{position:'absolute',right:w*.055,top:h*.057,fontSize:w*(portrait?.022:.010),letterSpacing:'.13em',color:'#9a9cac'}}>{String(index+1).padStart(2,'0')} / {String(plan.scenes.length).padStart(2,'0')}</div>
    {split?<div style={{position:'absolute',left:w*.055,top:h*.27,width:w*.345,transform:`translateY(${(1-enter)*20}px)`,opacity:enter}}>
      <div style={{fontSize:w*.0105,color:'#b9afd9',fontWeight:600,letterSpacing:'.14em',marginBottom:h*.024}}>{scene.eyebrow??(hero?'КАК ЭТО РАБОТАЕТ':'РЕЗУЛЬТАТ')}</div>
      <div style={{whiteSpace:'pre-line',fontSize:w*.049,lineHeight:1.035,fontWeight:720,letterSpacing:'-.055em'}}>{scene.title}</div>
      <div style={{marginTop:h*.035,width:w*.052,height:4,background:plan.accent,borderRadius:2}}/>
    </div>:<div style={{position:'absolute',left:w*.055,top:h*(portrait?.14:.104),fontSize:w*(portrait?.065:.029),fontWeight:650,letterSpacing:'-.035em',transform:`translateY(${(1-enter)*12}px)`,opacity:enter}}>{scene.title}</div>}
    <div style={{position:'absolute',left:box.x,top:box.y+(split?(1-enter)*h*.025:0),width:box.width,height:box.height,borderRadius:w*.012,overflow:'hidden',background:'#f4f5f9',border:'1px solid #ffffff30',boxShadow:'0 30px 90px #00000065'}}>
      <div style={{position:'absolute',width:baseW,height:baseH,transform:`translate(${tx}px,${ty}px) scale(${scale})`,transformOrigin:'0 0'}}>
        {scene.kind==='video'&&frame<videoFrames?<OffthreadVideo muted src={asset(scene.sourcePath)} startFrom={Math.round(scene.sourceStartMs/1000*fps)} endAt={Math.round(scene.sourceEndMs/1000*fps)} playbackRate={scene.playbackRate} style={{width:baseW,height:baseH}}/>:<Img src={asset(scene.kind==='video'?scene.holdPath!:scene.sourcePath)} style={{width:baseW,height:baseH}}/>}
      </div>
      {scene.events.length>0&&<div style={{position:'absolute',left:tx+px*baseW*scale,top:ty+py*baseH*scale,opacity:cursorOpacity,filter:'drop-shadow(0 2px 2px #00000040)'}}><svg width={w*.014} height={w*.020} viewBox="0 0 24 34"><path d="M2 2 L2 27 L8.5 21 L14 32 L19 29 L13.5 19 L23 19 Z" fill="#212638" stroke="white" strokeWidth="2"/></svg></div>}
      {scene.events.map((event,i)=>{const age=(frame-event.frame)/fps;const size=w*(.011+age*.032);return age>=0&&age<.42?<div key={i} style={{position:'absolute',left:tx+event.x*baseW*scale,top:ty+event.y*baseH*scale,width:size,height:size,transform:'translate(-50%,-50%)',border:`2px solid ${plan.accent}`,borderRadius:'50%',opacity:1-age/.42}}/>:null;})}
    </div>
    {subtitleOn&&<div style={{position:'absolute',left:w*.08,right:w*.08,bottom:h*(portrait?.17:.042),textAlign:'center',fontSize:w*(portrait?.032:.017),fontWeight:450,lineHeight:1.35,color:'#e3e2e9',maxHeight:h*.08}}>{scene.caption}</div>}
  </AbsoluteFill>;
}
