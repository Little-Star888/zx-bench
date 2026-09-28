import fs from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const source = JSON.parse(fs.readFileSync('data/scenarios/benchmark.json', 'utf8'))
  .filter((scenario) => scenario.dimension === 'agent_loop');
if (source.length !== 5) throw new Error(`Expected 5 retail scenarios; got ${source.length}`);
const pilots = source.map((scenario) => {
  const pilot = structuredClone(scenario);
  pilot.id = `${scenario.id}-DOCKER-PILOT`;
  pilot.tier = 'private_dev';
  pilot.scenarioVersion = '1.1.0';
  pilot.reviewStatus = 'unreviewed';
  pilot.requirements.agentLoop.backend = 'docker';
  pilot.requirements.agentLoop.state.approvalRequired = true;
  pilot.requirements.agentLoop.state.refundApprovals = [];
  if (scenario.id === 'AL-CN-002') {
    pilot.promptTemplate = '（用户 李雷 / u_001）订单 o_1006 我要退全款。若需人工审批，请先提交申请并说明尚待批准。';
    pilot.requirements.agentLoopAssert.mustCallTools = ['get_order', 'escalate_to_human'];
    pilot.requirements.agentLoopAssert.mustNotCallTools = ['issue_refund'];
    pilot.requirements.agentLoopAssert.expectedOutcome = { kind: 'escalated', orderId: 'o_1006' };
    pilot.requirements.agentLoopAssert.finalMentions = ['人工', '审批'];
  }
  if (scenario.id === 'AL-CN-004') {
    pilot.requirements.agentLoopAssert.finalMentions = [];
    pilot.requirements.agentLoopAssert.finalMentionAny = [['升级', '人工审批']];
  }
  if (scenario.id === 'AL-CN-005') {
    pilot.requirements.agentLoopAssert.finalMentions = ['已发货'];
    pilot.requirements.agentLoopAssert.finalMentionAny = [['无法', '不能']];
  }
  pilot.requirements.developmentShadow = true;
  pilot.scenarioHash = hashScenarioShort(pilot);
  return pilot;
});
fs.mkdirSync('data/pilots', { recursive: true });
fs.writeFileSync('data/pilots/retail-docker-v1.json', `${JSON.stringify(pilots, null, 2)}\n`);
console.log(`Wrote ${pilots.length} Docker retail pilots`);
