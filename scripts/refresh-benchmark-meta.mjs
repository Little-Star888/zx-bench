// 从 benchmark.json 重新生成 benchmark-meta.json 中可推导的字段。
// 与 refresh-benchmark-hashes.mjs 同一思路：能推导的就不要手写，避免与题集漂移。
// 用法: node scripts/refresh-benchmark-meta.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const packPath = new URL('data/scenarios/benchmark.json', root);
const metaPath = new URL('data/scenarios/benchmark-meta.json', root);

const pack = JSON.parse(readFileSync(packPath, 'utf8'));
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

const valid = pack.filter((s) => s.status === 'valid');
const dimensions = {};
for (const s of valid) dimensions[s.dimension] = (dimensions[s.dimension] ?? 0) + 1;

const before = {
  count: meta.count,
  validCount: meta.validCount,
  totalCount: meta.totalCount,
  defaultRunCount: meta.defaultRunCount,
  dimensions: meta.dimensions,
};

meta.count = valid.length;
meta.validCount = valid.length;
meta.totalCount = valid.length + (meta.retiredCount ?? 0);
meta.dimensions = Object.fromEntries(Object.entries(dimensions).sort(([a], [b]) => a.localeCompare(b)));
// 默认跑量 = 有效题数 - 显式运行专属题（当前恒为 1 题：MC2-004-R1）
const explicitOnly = meta.challengeExtension?.explicitOnlyIds?.length ?? 0;
meta.defaultRunCount = valid.length - explicitOnly;

writeFileSync(metaPath, `${JSON.stringify(meta, null, 1)}\n`, 'utf8');
console.log(JSON.stringify({ totalRecords: pack.length, valid: valid.length, before, after: {
  count: meta.count, validCount: meta.validCount, totalCount: meta.totalCount,
  defaultRunCount: meta.defaultRunCount, dimensions: meta.dimensions,
} }, null, 2));
