import fs from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const base = JSON.parse(fs.readFileSync('data/scenarios/benchmark.json', 'utf8'))
  .find((scenario) => scenario.id === 'CLI-CN-001');

function logCase(count) {
  const records = [];
  for (let i = 1; i <= count; i++) {
    for (let repeat = 0; repeat < i; repeat++) records.push(`10.0.0.${i} - - [01/Jan/2026:00:00:00 +0000] "GET / HTTP/1.1" 200 1`);
  }
  const sorted = Array.from({ length: 20 }, (_, offset) => {
    const number = count - offset;
    return `${String(number).padStart(7)} 10.0.0.${number}`;
  });
  return { files: [{ path: 'access.log', content: `${records.join('\n')}\n` }],
    expectedFiles: { 'top_ips.txt': `${sorted.join('\n')}\n` },
    tokenWhitespaceFiles: ['top_ips.txt'],
    unchangedFiles: ['access.log'] };
}

const pilot = {
  ...base,
  id: 'CLI-PILOT-001',
  tier: 'private_dev',
  responseMode: 'live_execution',
  scenarioVersion: '1.0.0',
  promptTemplate: '在当前 /workspace 中，access.log 是 Apache 日志。请提交一段 shell 脚本，把访问次数最多的前 20 个客户端 IP 写入 top_ips.txt。每行格式为“<次数> <IP>”，按次数降序；保留输入文件。只输出脚本，允许使用任意可用命令。',
  requirements: { executionImage: 'python:3.12-alpine', executionCases: [logCase(21), logCase(23)], developmentShadow: true },
  scoring: { type: 'cli_command', mode: 'executed_state' },
  reviewStatus: 'unreviewed',
};
pilot.scenarioHash = hashScenarioShort(pilot);
fs.mkdirSync('data/pilots', { recursive: true });
fs.writeFileSync('data/pilots/cli-execution-v1.json', `${JSON.stringify([pilot], null, 2)}\n`);
console.log('Wrote one CLI execution pilot with two independent fixtures');
