import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scenario, ModelConfig, EvalRunConfig, ModelResponse } from '@zxbench/types';
import { structuredContractEvaluator, prepareStructuredContract } from './structuredContract.js';
import { registerEvaluator } from './index.js';
import { orchestrateEvaluation } from '../orchestrator.js';
import { callModelWithRetry } from '../model/caller.js';
import { runJudgeEnsemble } from '../judge/index.js';
import { classifyEngineeringFailure } from '../scoring.js';
import { analyzeRunQuality } from '../quality.js';

vi.mock('../model/caller.js', () => ({ callModelWithRetry: vi.fn() }));
vi.mock('../judge/index.js', async original => ({ ...await original<object>(), runJudgeEnsemble: vi.fn() }));
const scenario = (schema: unknown, extra = {}) => ({ id:'CONTRACT', dimension:'structured_output',
  grader:'structured_contract', graderVersion:'structured_contract_v1', scenarioVersion:'1', promptTemplate:'Return JSON',
  scoring:{type:'schema_compliance'}, requirements:{format:'json',dialect:'draft-07',schema,
    formatAssertions:true,family:'fixture',output_policy:'raw_only',...extra} }) as unknown as Scenario;
const grade = (s:Scenario, out:string) => structuredContractEvaluator.evaluate(s,out,{} as never,{} as never);
const model = {id:'mock',name:'mock',provider:'openai',baseUrl:'https://example.invalid',defaultParams:{}} as ModelConfig;
const config = {maxTokens:1024,temperature:0,runsPerQuestion:1,judgeEnabled:true,
  safetyCheckEnabled:false,structuredOutputEnabled:false} as EvalRunConfig;
beforeEach(()=> {vi.clearAllMocks();registerEvaluator(structuredContractEvaluator);});

describe('standard structured contract',()=>{
  it('compares object-valued const/enum semantically, including reordered keys',async()=>{
    const s=scenario({anyOf:[{const:{a:1,b:false}},{enum:[{a:[1,2],b:null}]}]});
    expect((await grade(s,'{"b":false,"a":1}')).totalScore).toBe(100);
    expect((await grade(s,'{"b":null,"a":[1,2]}')).totalScore).toBe(100);
    expect((await grade(s,'{"a":[2,1],"b":null}')).totalScore).toBe(0);
  });
  it('supports composed evaluated properties under 2020-12',async()=>{
    const s=scenario({$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',
      allOf:[{properties:{a:{type:'integer'}},required:['a']}],unevaluatedProperties:false},{dialect:'2020-12'});
    expect((await grade(s,'{"a":2}')).totalScore).toBe(100);
    expect((await grade(s,'{"a":2,"other":3}')).totalScore).toBe(0);
  });
  it('rejects envelopes, trailing text and empty output without rescue',async()=>{
    for(const out of ['', '```json\n{}\n```','{} explanation']){
      const r=await grade(scenario({type:'object'}),out);
      expect(r.structuredContractMetrics?.syntaxValid).toBe(false);
      expect(r.totalScore).toBe(0);
    }
  });
  it('separates schema validity from content correctness and decodes JSON Pointer escapes',async()=>{
    const s=scenario({type:'object'},{assertions:[{pointer:'/a~1b~0c',expected:false,description:'Keep false'}]});
    expect((await grade(s,'{"a/b~c":false}')).totalScore).toBe(100);
    const r=await grade(s,'{"a/b~c":true}');
    expect(r.structuredContractMetrics).toMatchObject({schemaValid:true,contentValid:false,complete:false});
    expect(r.structuredContractMetrics!.partialScore).toBeGreaterThan(0);
    expect(r.totalScore).toBe(0);
  });
  it('does not coerce/default/drop fields and enforces requested format assertions',async()=>{
    const s=scenario({type:'object',properties:{n:{type:'integer',default:1},date:{type:'string',format:'date'}},required:['n','date'],additionalProperties:false});
    for(const data of [{date:'2024-02-29'},{n:'1',date:'2024-02-29'},{n:1,date:'2023-02-29'},{n:1,date:'2024-02-29',extra:0}]){
      expect((await grade(s,JSON.stringify(data))).totalScore).toBe(0);
    }
    expect((await grade(s,'{"n":1,"date":"2024-02-29"}')).totalScore).toBe(100);
  });
  it('reports unsupported or unfrozen contracts as unavailable, not a model failure',async()=>{
    for(const schema of [{unknownAssertion:true},{$ref:'https://example.invalid/missing'},{$schema:'https://json-schema.org/draft/2020-12/schema'}]){
      const r=await grade(scenario(schema),'{}');
      expect(r.environmentError).toBe(true);
      expect(r.structuredContractMetrics).toBeUndefined();
    }
    expect(()=>prepareStructuredContract(scenario(true,{assertions:[{pointer:'/bad~2',expected:0,description:'x'}]}).requirements as never)).toThrow();
  });
  it('counts a successful empty generation as one failed attempt with no budget retry or Judge',async()=>{
    vi.mocked(callModelWithRetry).mockResolvedValue({content:'',finishReason:'length',latencyMs:1,usage:{inputTokens:10,outputTokens:1024,totalTokens:1034}} as ModelResponse);
    const r=await orchestrateEvaluation({scenario:scenario({type:'object'}),modelConfig:model,modelParams:{},evalConfig:config,judgeOptions:{localModel:model}});
    expect(callModelWithRetry).toHaveBeenCalledTimes(1);
    expect(runJudgeEnsemble).not.toHaveBeenCalled();
    expect(r.totalScore).toBe(0);
    expect(r.formatParseSuccess).toBe(false);
    expect(r.runCount).toBe(1);
    expect(classifyEngineeringFailure(r)).toBeNull();
    expect(r.outputMetadata.evaluationAudit?.structuredContractMetrics?.complete).toBe(false);
    const quality=analyzeRunQuality([{...r,judgeScore:null,deterministicScore:0,outputMetadata:JSON.stringify(r.outputMetadata),evidence:JSON.stringify(r.evidence),scoreHistory:JSON.stringify(r.scoreHistory),finalJudge:null}],1);
    expect(quality.structuredContracts).toMatchObject({scoredSamples:1,completeRate:0,unavailableSamples:0});
    expect(quality.zeroDeterministCount).toBe(0);
  });
  it('rejects invalid schemas before spending a model request',async()=>{
    await expect(orchestrateEvaluation({scenario:scenario({unknownAssertion:true}),modelConfig:model,modelParams:{},evalConfig:config})).rejects.toThrow();
    expect(callModelWithRetry).not.toHaveBeenCalled();
  });
  it('does not turn a measured failure into a manual-review ticket',async()=>{
    vi.mocked(callModelWithRetry).mockResolvedValue({content:'{"unwanted":"some ordinary answer"}',finishReason:'stop',latencyMs:1,usage:{inputTokens:10,outputTokens:10,totalTokens:20}} as ModelResponse);
    const r=await orchestrateEvaluation({scenario:scenario({const:{expected:1}}),modelConfig:model,modelParams:{},evalConfig:config,judgeOptions:{localModel:model}});
    expect(r.totalScore).toBe(0);
    expect(r.humanReviewRequired).toBe(false);
    expect(runJudgeEnsemble).not.toHaveBeenCalled();
  });
  it('counts every saved attempt instead of the representative output',async()=>{
    const good=await grade(scenario(true),'{}'),bad=await grade(scenario(false),'{}');
    const row={graderVersion:'structured_contract@structured_contract_v1',totalScore:50,judgeScore:null,modelOutput:'{}',
      deterministicScore:50,outputMetadata:JSON.stringify({evaluationAudit:{structuredContractMetrics:good.structuredContractMetrics,
        attempts:[good,bad,{...bad,environmentError:true}]}})};
    expect(analyzeRunQuality([row],1).structuredContracts).toMatchObject({scoredSamples:2,completeRate:0.5,familyMacroRate:0.5,unavailableSamples:1});
  });
});
