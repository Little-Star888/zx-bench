// Idempotent migration of the two free-form PR reviews to deterministic evidence tasks.
import { readFileSync, writeFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const bankPath = new URL('../data/scenarios/benchmark.json', import.meta.url);
const metaPath = new URL('../data/scenarios/benchmark-meta.json', import.meta.url);
const bank = JSON.parse(readFileSync(bankPath, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));

const sql = byId.get('PR-ELITE-012');
const shard = byId.get('PR-ELITE-013');
if (!sql || !shard) throw new Error('PR-ELITE-012/013 missing');

const sqlPrompt = `你需要修复一个可重放的 SQL 注入缺陷，而不是撰写自然语言 PR 评论。
缺陷改动：src/db/admin_lookup.sql.jstemplate 将参数化查询改成了：
return db.query(\`SELECT * FROM users WHERE login = '\${name}'\`);

独立 SQLite 环境的表结构为：CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE COLLATE BINARY, role TEXT NOT NULL)。
请提交：(1) 一个 name 反例，必须使缺陷查询返回至少一条真实存在且 login 不等于该 name 的记录；(2) 修复后的单条只读 SELECT 和绑定声明。
修复必须按 BINARY 大小写规则精确匹配 login，返回 id/login/role 原值，不存在时返回空集，并适用于变化后的记录 ID、角色、新增账号、空名称及最长 2048 字符名称。禁止写操作、PRAGMA、ATTACH、多语句、schema 读取和扩展加载。

仅输出严格 JSON，不使用代码块或额外字段：
{"protocol":"pr-witness-sql-v1","witness":{"name":"注入反例"},"patch":{"sql":"参数化 SQL","bindings":["name"]}}`;

const shardPrompt = `你需要修复租户分片 PR 的可重放架构缺陷，而不是撰写自然语言评审。
原方案：(1) tenant_id 直接哈希，但最大单租户占 62% 流量；(2) 双写不回填、不对账；(3) 一次性全局切读；(4) 回滚窗口的新写入只在新库；(5) 无 kill-switch；(6) 跨分片事务直接抛错。

请提交两个反例和一份机器可执行迁移配置：
- rollback.beforeCutover/afterCutover：各给出至少一个不同记录 ID，重放原方案回滚后的数据缺失。
- hotspot：一个热租户、至少 8 个不同实体 ID，以及至少 2 个其他租户，重放 tenant_id 单键热点。
- patch.routing：采用 tenant_id_plus_entity_id，8–256 个虚拟桶；跨桶事务必须使用 saga，而不是拒绝业务请求。
- patch.migration：要求持久双写、切读前回填与对账、按租户灰度、kill-switch，以及回滚前反向同步，六项均必须启用。

同一配置会在运行时生成的反事实实体集合上重放，不能依赖题面示例 ID。仅输出严格 JSON，不使用代码块或额外字段：
{"protocol":"pr-witness-sharding-v1","witness":{"rollback":{"beforeCutover":["..."],"afterCutover":["..."]},"hotspot":{"hotTenant":"...","hotEntityIds":["至少8个不同ID"],"otherTenants":["至少2个不同租户"]}},"patch":{"routing":{"key":"tenant_id_plus_entity_id","virtualBuckets":64,"crossBucketTransactions":"saga"},"migration":{"durableDualWrite":true,"backfillBeforeRead":true,"reconcileBeforeRead":true,"perTenantCanary":true,"killSwitch":true,"reverseSyncBeforeRollback":true}}}`;

for (const [scenario, prompt, category, protocol] of [
  [sql, sqlPrompt, 'executable_security_patch', 'pr-witness-sql-v1'],
  [shard, shardPrompt, 'executable_architecture_patch', 'pr-witness-sharding-v1'],
]) {
  scenario.promptTemplate = prompt;
  scenario.category = category;
  scenario.language = 'json';
  scenario.grader = 'pr_executable_evidence';
  scenario.graderVersion = '1.0.0';
  scenario.scenarioVersion = '4.0.0';
  scenario.scoring = { type: 'executable_evidence', weights: { replayable_witness: 0.25, executable_repair: 0.75 } };
  scenario.requirements = { prompt, protocol, automaticOnly: true, judgeWeight: 0 };
  scenario.hiddenTests = [];
  scenario.tags = ['pr_review', 'executable_evidence', category];
  scenario.reviewStatus = 'verified';
  scenario.goldSource = 'trusted_executable_contract_v1';
  scenario.scenarioHash = hashScenarioShort(scenario);
}

writeFileSync(bankPath, JSON.stringify(bank, null, 1) + '\n');
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
meta.version = '1.29.0';
meta.executionReview = 'code-4.14-pr-executable-evidence-1.0';
meta.prReview = { version: '1.0.0', automaticOnly: true, judgeWeight: 0, humanReviewRequired: false,
  scenarios: ['PR-ELITE-012', 'PR-ELITE-013'], protocols: ['pr-witness-sql-v1', 'pr-witness-sharding-v1'] };
writeFileSync(metaPath, JSON.stringify(meta, null, 1) + '\n');
console.log('Migrated PR-ELITE-012/013 to pr_executable_evidence@1.0.0');
