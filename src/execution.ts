import {assertUnderstanding,beginStageAttempt,finishStageAttempt,type UnderstandingConfig,type UnderstandingResult} from './understanding.js';
import {hash} from './util.js';

/** Check evidence before expensive side effects and bound retries of identical work. */
export async function executeReviewedStage<T>(options:{
  config:UnderstandingConfig & {project?:string;analysisFile?:string};
  runDir:string;stage:'capture'|'render';inputs:unknown|(()=>Promise<unknown>);execute:(review:UnderstandingResult)=>Promise<T>;
}):Promise<T>{
  const {config,runDir,stage}=options;
  const review=await assertUnderstanding({project:config.project||process.cwd(),config,manifestPath:config.analysisFile});
  const inputs=typeof options.inputs==='function'?await options.inputs():options.inputs;
  const {attemptId}=await beginStageAttempt(runDir,{stage,inputHash:hash({inputs,analysisHash:review.analysisHash})});
  try{
    const result=await options.execute(review);
    await finishStageAttempt(runDir,{attemptId,status:'passed'});
    return result;
  }catch(error){
    await finishStageAttempt(runDir,{attemptId,status:'failed',failureCode:'stage_failed'});
    throw error;
  }
}
