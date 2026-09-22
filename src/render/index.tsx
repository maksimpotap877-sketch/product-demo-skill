import React from 'react';
import {Composition,registerRoot} from 'remotion';
import {Demo} from './Composition.js';
import type {EditPlan} from '../schema.js';
const Root=()=> <Composition id="ProductDemo" component={Demo} width={1920} height={1080} fps={60} durationInFrames={60} defaultProps={{plan:{} as EditPlan}} calculateMetadata={({props})=>({width:props.plan.profile.width,height:props.plan.profile.height,fps:props.plan.profile.fps,durationInFrames:props.plan.durationFrames})}/>;
registerRoot(Root);
