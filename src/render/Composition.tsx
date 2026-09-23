import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import type {EditPlan} from '../schema.js';
import {CinematicScene} from './Cinematic.js';
import {ProductSurface} from './Surface.js';

function ClassicScene({scene, plan}: {scene: EditPlan['scenes'][number]; plan: EditPlan}) {
  const frame = useCurrentFrame(), {width, height, fps} = useVideoConfig();
  const portrait = height > width;
  const subtitleOn = frame >= Math.round(fps * .25) && frame < Math.round(fps * (scene.voiceDurationMs / 1000 + .48));
  return <AbsoluteFill style={{background: '#eef0f7', fontFamily: "'Segoe UI', Arial, sans-serif", color: '#192035'}}>
    <div style={{position: 'absolute', left: width * .04, top: height * .04, maxWidth: width * (portrait ? .6 : .21), fontSize: width * (portrait ? .032 : .014), fontWeight: 650}}>{plan.brandName ?? plan.title}</div>
    <div style={{position: 'absolute', left: width * (portrait ? .05 : .285), right: width * .04, top: height * (portrait ? .115 : .028), fontSize: width * (portrait ? .055 : .018), lineHeight: 1.12, fontWeight: 650}}>{scene.title}</div>
    <ProductSurface scene={scene} plan={plan}/>
    {subtitleOn && <div style={{position: 'absolute', left: width * .045, right: width * .045, top: height * (portrait ? .82 : .915), textAlign: 'center', fontSize: width * (portrait ? .03 : .0115), lineHeight: 1.35, color: '#38445b'}}>{scene.caption}</div>}
    <svg width={width} height={4} style={{position: 'absolute', bottom: 0, left: 0}}><rect x={0} y={0} width={width * (scene.outputStartFrame + frame) / plan.durationFrames} height={4} fill={plan.accent}/></svg>
  </AbsoluteFill>;
}

export function Demo({plan}: {plan: EditPlan}) {
  return <AbsoluteFill style={{background: plan.presentation === 'cinematic' ? '#11141d' : '#eef0f7'}}>{plan.scenes.map((scene, index) => <Sequence key={scene.sceneId} from={scene.outputStartFrame} durationInFrames={scene.outputDurationFrames}>{plan.presentation === 'cinematic' ? <CinematicScene scene={scene} plan={plan} index={index}/> : <ClassicScene scene={scene} plan={plan}/>}</Sequence>)}</AbsoluteFill>;
}
