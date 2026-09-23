import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {EditPlan} from '../schema.js';
import {ProductSurface} from './Surface.js';
import {sceneGeometry, smoothStep} from './motion.js';

export function CinematicScene({scene, plan, index}: {scene: EditPlan['scenes'][number]; plan: EditPlan; index: number}) {
  const frame = useCurrentFrame(), {width: w, height: h, fps} = useVideoConfig();
  const {portrait, split} = sceneGeometry(plan, scene);
  const titleOpacity = smoothStep(frame / Math.max(1, fps * .25));
  const subtitleOn = frame >= Math.round(fps * .25) && frame < Math.round(fps * (scene.voiceDurationMs / 1000 + .48));
  return <AbsoluteFill style={{fontFamily: "'Segoe UI', Arial, sans-serif", background: '#11141d', color: '#f7f7fa', overflow: 'hidden'}}>
    <AbsoluteFill style={{background: 'radial-gradient(ellipse at 70% 55%, #292939 0%, #11141d 80%)'}}/>
    <div style={{position: 'absolute', left: w * .04, top: h * .04, maxWidth: w * (portrait || split ? .6 : .21), display: 'flex', gap: w * .008, alignItems: 'center', fontSize: w * (portrait ? .032 : .014), fontWeight: 650}}><span style={{flexShrink: 0, width: w * .012, height: w * .012, borderRadius: w * .004, background: plan.accent}}/>{plan.brandName ?? plan.title}</div>
    {(portrait || split) && <div style={{position: 'absolute', right: w * .05, top: h * .05, fontSize: w * (portrait ? .022 : .01), letterSpacing: '.1em', color: '#9a9cac'}}>{String(index + 1).padStart(2, '0')} / {String(plan.scenes.length).padStart(2, '0')}</div>}
    {split ? <div style={{position: 'absolute', left: w * .05, top: h * .28, width: w * .325, opacity: titleOpacity}}>
      <div style={{fontSize: w * .0105, color: '#b9afd9', fontWeight: 600, letterSpacing: '.12em', marginBottom: h * .022}}>{scene.eyebrow ?? (scene.layout === 'hero' ? 'КАК ЭТО РАБОТАЕТ' : 'РЕЗУЛЬТАТ')}</div>
      <div style={{whiteSpace: 'pre-line', overflowWrap: 'anywhere', fontSize: w * .045, lineHeight: 1.09, fontWeight: 700, letterSpacing: '-.035em'}}>{scene.title}</div>
      <div style={{marginTop: h * .03, width: w * .05, height: 3, background: plan.accent, borderRadius: 2}}/>
    </div> : <div style={{position: 'absolute', left: w * (portrait ? .05 : .285), right: w * .04, top: h * (portrait ? .115 : .028), fontSize: w * (portrait ? .055 : .018), fontWeight: 650, letterSpacing: '-.025em', lineHeight: 1.12, opacity: titleOpacity}}>{scene.title}</div>}
    <ProductSurface scene={scene} plan={plan}/>
    {subtitleOn && <div style={{position: 'absolute', left: w * .045, right: w * .045, top: h * (portrait ? .82 : .915), textAlign: 'center', fontSize: w * (portrait ? .03 : .0115), fontWeight: 450, lineHeight: 1.35, color: '#e3e2e9'}}>{scene.caption}</div>}
  </AbsoluteFill>;
}
