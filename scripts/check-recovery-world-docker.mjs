import fs from 'node:fs';
import { recoveryWorldTasks } from './lib/recovery-world-tasks.mjs';
import { DockerToolWorld } from '../packages/core/dist/execution/toolWorld.js';
import { evaluateWorldTrace } from '../packages/core/dist/evaluators/worldTrace.js';
import { sourceHashes } from './lib/execution-source-hashes.mjs';
import { digest, taskContract, reuseDecision, strictSuccess } from './lib/execution-task-pack.mjs';
const scenarios=JSON.parse(fs.readFileSync('data/pilots/recovery-world-docker-v1.json','utf8'));
const hashes=sourceHashes();
const only=process.argv.find(a=>a.startsWith('--task='))?.slice(7);
for(const scenario of scenarios) {
  if(only && scenario.id!==only) continue;
  const fixture=recoveryWorldTasks.find(t=>scenario.id===`${t.sourceId}-RECOVERY-${t.variant}`);
  const config=scenario.requirements.executionWorld;
  const dir=`data/execution/tasks/${scenario.id}`; fs.mkdirSync(dir,{recursive:true});
  const contract=taskContract(scenario,hashes.runtime,hashes.verifier);
  const witnessHash=digest({reference:fixture.reference,counterexample:fixture.counterexample,
    referenceMessage:fixture.referenceMessage,counterexampleMessage:fixture.counterexampleMessage});
  const reportPath=`${dir}/reference-report.json`;
  const old=fs.existsSync(reportPath)?JSON.parse(fs.readFileSync(reportPath,'utf8')):null;
  if(old?.passed && old.witnessHash===witnessHash && reuseDecision(old.contract,contract)==='reuse') {
    console.log(`${scenario.id}: reused reference evidence`); continue;
  }
  async function run(calls, finalMessage) {
    const world=await DockerToolWorld.create(config.initialState,config.tools,config.image,config.expectedImageId,120000);
    try {
      for(const c of calls) await world.call(c.tool,c.args);
      const trace={imageId:world.imageId,initialState:config.initialState,finalState:world.snapshot(),events:world.events,
        turns:[],finalMessage:finalMessage ?? '已根据真实工具结果处理并报告。',turnErrors:[],elapsedMs:0};
      return {result:evaluateWorldTrace(scenario,{executionWorld:trace}),trace};
    } finally {await world.close();}
  }
  const regrade=old?.witnessHash===witnessHash && old.positive?.trace && old.negative?.trace
    && reuseDecision(old.contract,contract)==='regrade';
  const positive=regrade?{trace:old.positive.trace,result:evaluateWorldTrace(scenario,{executionWorld:old.positive.trace})}:await run(fixture.reference,fixture.referenceMessage);
  const negative=regrade?{trace:old.negative.trace,result:evaluateWorldTrace(scenario,{executionWorld:old.negative.trace})}:await run(fixture.counterexample,fixture.counterexampleMessage);
  const passed=strictSuccess(positive.result)&&!strictSuccess(negative.result)&&!negative.result.environmentError;
  for(const [name,value] of Object.entries({scenario,reference:fixture.reference,counterexample:fixture.counterexample}))
    fs.writeFileSync(`${dir}/${name}.json`,JSON.stringify(value,null,2)+'\n');
  fs.writeFileSync(reportPath,JSON.stringify({checkedAt:new Date().toISOString(),contract,witnessHash,passed,positive,negative},null,2)+'\n');
  if(!passed) throw Error(`Failed ${scenario.id}: ${positive.result.totalScore}/${negative.result.totalScore}`);
  console.log(`${scenario.id}: ${regrade?'regraded stored trace; ':''}reference 100, counterexample ${negative.result.totalScore}`);
}
