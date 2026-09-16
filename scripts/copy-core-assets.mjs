// ============================================================
// 把 @zxbench/core 的运行时资源从 src 复制到 dist。
//
// 背景（2026-09-16）：`evaluationLab/examExpansion/index.ts` 原先用
// `import ... with { type: 'json' }` 加载 math-candidates.json —— 那种写法会让 tsc
// 把 JSON 一并输出到 dist，但也依赖 Node 的 JSON import attribute（产物缺该 attribute 时
// 启动即抛 ERR_IMPORT_ATTRIBUTE_MISSING，曾导致 watchdog 连续 3 次失败后放弃重启）。
// 改为 readFileSync 后与 import attribute 解耦，代价是 tsc 不再自动拷贝该文件，
// 因此必须显式复制，否则干净构建出来的 dist 缺文件、服务启动即崩。
//
// 用法：packages/core 的 build 脚本会在 tsc 之后调用本脚本。幂等。
// ============================================================
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = join(repoRoot, 'packages', 'core');

/** 运行时代码通过 readFileSync 读取的资源（相对 packages/core） */
const RUNTIME_ASSETS = [
  'src/evaluationLab/examExpansion/math-candidates.json',
];

let copied = 0;
const missing = [];
for (const rel of RUNTIME_ASSETS) {
  const from = join(coreRoot, rel);
  const to = join(coreRoot, rel.replace(/^src\//, 'dist/'));
  if (!existsSync(from)) { missing.push(rel); continue; }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied += 1;
  console.log(`  asset ${rel} -> dist (${statSync(to).size} bytes)`);
}

if (missing.length) {
  console.error(`copy-core-assets: 缺少运行时资源：${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`copy-core-assets: ${copied} 个运行时资源已同步到 dist`);
}
