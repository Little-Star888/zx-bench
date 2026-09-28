import fs from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const bank = JSON.parse(fs.readFileSync('data/scenarios/benchmark.json', 'utf8'));
const image = 'python:3.12-alpine';
const imageId = 'sha256:d09d15e60962ca365d1cd544a48773bac9d33f2fb1b00f2aa0deec78ade7dc31';
const input = (path, content) => ({ path, content });
const makeCase = (files, result) => ({ files, ...result, unchangedFiles: files.map((file) => file.path) });
const lines = (items) => `${items.join('\n')}\n`;
const setMtimes = (entries) => `python3 - <<'PY'\nimport os\nfrom datetime import datetime, timezone\nfor path, iso in ${JSON.stringify(entries)}:\n    timestamp = datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp()\n    os.utime(path, (timestamp, timestamp))\nPY`;

const fixtures = {
  'CLI-CN-002': [
    makeCase([input('mixed.txt', 'mailto:Alice.Example+tag@Example.COM, alice.example+TAG@example.com; CSV,"bob_2@sub.test.org"; x@y.co!\n')],
      { expectedFiles: { 'emails.txt': lines(['alice.example+tag@example.com', 'bob_2@sub.test.org', 'x@y.co']) } }),
    makeCase([input('mixed.txt', 'NOPE, "Z@A.IO" / z@a.io; a.b+1@EXAMPLE.net.\n')],
      { expectedFiles: { 'emails.txt': lines(['a.b+1@example.net', 'z@a.io']) } }),
  ],
  'CLI-CN-003': [
    makeCase([input('a.txt', lines(['apple', 'shared', 'apple', 'zebra', 'shared', 'tail'])),
      input('b.txt', lines(['shared', 'other']))],
      { expectedFiles: { 'only_in_a.txt': lines(['apple', 'apple', 'zebra', 'tail']) } }),
    makeCase([input('a.txt', lines(['x y', 'same', 'x y', 'last', 'same'])),
      input('b.txt', lines(['same']))],
      { expectedFiles: { 'only_in_a.txt': lines(['x y', 'x y', 'last']) } }),
  ],
  'CLI-CN-004': [
    makeCase([input('report.txt', 'head\n---BEGIN NOTE---\nsecret 1\nsecret 2\n---END NOTE---\nmiddle\n---BEGIN NOTE---\nsecret 3\n---END NOTE---\ntail\n')],
      { expectedFiles: { 'redacted.txt': 'head\n[REDACTED]\nmiddle\n[REDACTED]\ntail\n' } }),
    makeCase([input('report.txt', '---BEGIN NOTE---\nx\n---END NOTE---\nkeep\n---BEGIN NOTE---\ny\nz\n---END NOTE---\n')],
      { expectedFiles: { 'redacted.txt': '[REDACTED]\nkeep\n[REDACTED]\n' } }),
  ],
  'CLI-CN-006': [
    makeCase([input('scores.txt', lines(['amy 9', 'bob 100', 'cam 12', 'dan 2']))],
      { expectedStdout: lines(['bob 100', 'cam 12', 'amy 9', 'dan 2']) }),
    makeCase([input('scores.txt', lines(['x 30', 'y 4', 'z 200', 'q 15']))],
      { expectedStdout: lines(['z 200', 'x 30', 'q 15', 'y 4']) }),
  ],
  'CLI-CN-007': [
    { files: [input('a/cat.jpeg', 'cat'), input('a/dog.jpeg', 'dog'), input('a/dog.jpg', 'existing'),
      input('a/file.jpeg.backup', 'keep'), input('b/deep/bird.jpeg', 'bird')],
      expectedFiles: { 'a/cat.jpg': 'cat', 'a/dog.jpg': 'existing', 'b/deep/bird.jpg': 'bird' },
      unchangedFiles: ['a/dog.jpeg', 'a/dog.jpg', 'a/file.jpeg.backup'],
      absentFiles: ['a/cat.jpeg', 'b/deep/bird.jpeg'] },
    { files: [input('x/nested/one.jpeg', 'one'), input('x/nested/two.jpeg', 'two'),
      input('x/nested/two.jpg', 'protected'), input('x/nested/name.jpeg.txt', 'other')],
      expectedFiles: { 'x/nested/one.jpg': 'one', 'x/nested/two.jpg': 'protected' },
      unchangedFiles: ['x/nested/two.jpeg', 'x/nested/two.jpg', 'x/nested/name.jpeg.txt'],
      absentFiles: ['x/nested/one.jpeg'] },
  ],
  'CLI-CN-008': [
    { files: [input('.now', '2026-01-01T00:00:00Z\n'), input('in/old.txt', 'old'),
      input('in/new.txt', 'new'), input('in/sub/very-old.txt', 'nested')],
      setupCommands: [setMtimes([['in/old.txt', '2025-11-01T00:00:00Z'],
        ['in/new.txt', '2025-12-15T00:00:00Z'], ['in/sub/very-old.txt', '2025-10-01T00:00:00Z']])],
      expectedFiles: { 'archive/old.txt': 'old' }, absentFiles: ['in/old.txt'],
      unchangedFiles: ['.now', 'in/new.txt', 'in/sub/very-old.txt'],
      assertCommands: [`python3 -c "import os; assert int(os.stat('archive/old.txt').st_mtime) == 1761955200"`] },
    { files: [input('.now', '2026-03-01T00:00:00Z\n'), input('in/stale.txt', 'stale'),
      input('in/fresh.txt', 'fresh')],
      setupCommands: [setMtimes([['in/stale.txt', '2026-01-01T00:00:00Z'],
        ['in/fresh.txt', '2026-02-15T00:00:00Z']])],
      expectedFiles: { 'archive/stale.txt': 'stale' }, absentFiles: ['in/stale.txt'],
      unchangedFiles: ['.now', 'in/fresh.txt'],
      assertCommands: [`python3 -c "import os; assert int(os.stat('archive/stale.txt').st_mtime) == 1767225600"`] },
  ],
  'CLI-CN-009': [
    { files: [input('files/old.txt', 'same'), input('files/new.txt', 'same'),
      input('files/unique.txt', 'unique')],
      setupCommands: [setMtimes([['files/old.txt', '2025-01-01T00:00:00Z'],
        ['files/new.txt', '2025-02-01T00:00:00Z'], ['files/unique.txt', '2025-03-01T00:00:00Z']])],
      expectedFiles: { 'files/old.txt': 'same', 'files/unique.txt': 'unique' },
      unchangedFiles: ['files/old.txt', 'files/unique.txt'], absentFiles: ['files/new.txt'] },
    { files: [input('files/a.txt', 'group1'), input('files/b.txt', 'group1'),
      input('files/c.txt', 'group1'), input('files/d.txt', 'group2'), input('files/e.txt', 'group2')],
      setupCommands: [setMtimes([['files/a.txt', '2025-03-01T00:00:00Z'],
        ['files/b.txt', '2025-01-01T00:00:00Z'], ['files/c.txt', '2025-02-01T00:00:00Z'],
        ['files/d.txt', '2025-04-01T00:00:00Z'], ['files/e.txt', '2025-05-01T00:00:00Z']])],
      expectedFiles: { 'files/b.txt': 'group1', 'files/d.txt': 'group2' },
      unchangedFiles: ['files/b.txt', 'files/d.txt'],
      absentFiles: ['files/a.txt', 'files/c.txt', 'files/e.txt'] },
  ],
  'CLI-CN-014': [
    makeCase([input('logs/a.log', 'ERROR first\nINFO skip\nERROR second\n'),
      input('logs/b.log', 'WARN ERROR middle\nERROR third\n'), input('logs/ignore.txt', 'ERROR ignored\n')],
      { expectedFiles: { 'errors.txt': lines(['a.log:ERROR first', 'a.log:ERROR second', 'b.log:ERROR third']) } }),
    makeCase([input('logs/z.log', 'ERROR last\n'), input('logs/a.log', 'ERROR start\nerror lowercase\n')],
      { expectedFiles: { 'errors.txt': lines(['a.log:ERROR start', 'z.log:ERROR last']) } }),
  ],
  'CLI-CN-017': [
    makeCase([input('access.log', lines([
      '10.0.0.1 - - [01/Jan/2026:00:00:00 +0000] "GET / HTTP/1.1" 200 12',
      '10.0.0.2 - - [01/Jan/2026:00:00:00 +0000] "GET /x HTTP/1.1" 404 0',
      '10.0.0.3 - - [01/Jan/2026:00:00:00 +0000] "POST / HTTP/1.1" 200 1',
      '10.0.0.4 - - [01/Jan/2026:00:00:00 +0000] "GET / HTTP/1.1" 200 2',
    ]))], { expectedStdout: lines(['3 200', '1 404']), tokenWhitespaceFiles: [] }),
    makeCase([input('access.log', lines([
      '10.0.0.1 - - [01/Jan/2026:00:00:00 +0000] "GET / HTTP/1.1" 500 1',
      '10.0.0.2 - - [01/Jan/2026:00:00:00 +0000] "GET / HTTP/1.1" 200 1',
      '10.0.0.3 - - [01/Jan/2026:00:00:00 +0000] "GET / HTTP/1.1" 500 1',
    ]))], { expectedStdout: lines(['2 500', '1 200']) }),
  ],
  'CLI-CN-049': [
    makeCase([input('app.log', lines(Array.from({ length: 14 }, (_, i) => `line-${i + 1}`)))],
      { expectedStdout: lines(Array.from({ length: 10 }, (_, i) => `line-${i + 5}`)) }),
    makeCase([input('app.log', lines(Array.from({ length: 11 }, (_, i) => `event-${i + 1}`)))],
      { expectedStdout: lines(Array.from({ length: 10 }, (_, i) => `event-${i + 2}`)) }),
  ],
  'CLI-CN-050': [
    makeCase([input('data.csv', lines(['name,value', 'a,1', 'b,2']))],
      { expectedStdoutPattern: '^\\s*3(?:\\s+data\\.csv)?\\s*$' }),
    makeCase([input('data.csv', lines(['col', 'x', 'y', 'z', 'w']))],
      { expectedStdoutPattern: '^\\s*5(?:\\s+data\\.csv)?\\s*$' }),
  ],
  'CLI-CN-051': [
    makeCase([input('syslog.txt', lines(['error happened', 'terror ignored', 'pre error post', 'ERROR uppercase']))],
      { expectedStdout: lines(['error happened', 'pre error post']) }),
    makeCase([input('syslog.txt', lines(['error', 'errors ignored', 'no issue', '[error] occurred']))],
      { expectedStdout: lines(['error', '[error] occurred']) }),
  ],
  'CLI-CN-053': [
    makeCase([input('logs/a.log', 'x\n'), input('logs/deep/b.log', 'y\n'), input('logs/deep/c.txt', 'z\n')],
      { expectedStdout: '2\n' }),
    makeCase([input('logs/a.log', 'x\n'), input('logs/deep/b.log', 'y\n'),
      input('logs/deep/deeper/c.log', 'z\n'), input('logs/d.LOG', 'x\n')], { expectedStdout: '3\n' }),
  ],
  'CLI-CN-056': [
    { files: [input('config.txt', 'foo=1\nfoobar\nfoo foo\n')],
      expectedFiles: { 'config.txt': 'bar=1\nbarbar\nbar bar\n' } },
    { files: [input('config.txt', 'prefix foo suffix\nfoofoo\nuntouched\n')],
      expectedFiles: { 'config.txt': 'prefix bar suffix\nbarbar\nuntouched\n' } },
  ],
};

const prompts = {
  'CLI-CN-002': 'mixed.txt 是混杂文本，含 mailto 链接和引号内邮箱。提取符合简化 RFC 模式 [A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,} 的所有邮箱，转为小写、不区分大小写去重后按 ASCII 升序写入 emails.txt。',
  'CLI-CN-003': 'a.txt 和 b.txt 已在工作区。将出现在 a.txt 但不在 b.txt 的行按 a.txt 原始顺序写入 only_in_a.txt，并保留符合条件的重复行。',
  'CLI-CN-004': 'report.txt 含多个由 ---BEGIN NOTE--- 和 ---END NOTE--- 界定的多行块。将每个完整块（含标记）替换为单行 [REDACTED]，写入 redacted.txt。',
  'CLI-CN-006': 'scores.txt 每行格式为 name score。按第 2 字段的数值降序将完整行输出到标准输出。',
  'CLI-CN-007': '递归查找 /workspace 下扩展名为 .jpeg 的文件并重命名为 .jpg。保留目录结构和其他文件；若对应 .jpg 已存在，不覆盖它，也不删除原 .jpeg。',
  'CLI-CN-008': 'in/ 中有不同修改时间的文件；.now 文件内容为 ISO 格式固定参考时间。把 in/ 顶层相对参考时间早于 30 天的文件移到 archive/，不递归子目录，保留文件修改时间。',
  'CLI-CN-009': 'files/ 中有内容相同的文件。按 SHA-256 对内容分组，每组只保留修改时间最旧的一个，删除同组其余文件，内容唯一的文件不动。',
  'CLI-CN-014': 'logs/ 下有若干 .log 文件。提取以 ERROR 开头的行写入 errors.txt；每行格式为「文件名:原始行」，按文件名排序，同一文件内保持原始顺序。',
  'CLI-CN-017': 'access.log 是 Apache 通用日志，状态码为第 9 个空格分隔字段。统计各状态码出现次数，按次数降序向标准输出写出「次数 状态码」。',
  'CLI-CN-049': '显示 app.log 的最后 10 行到标准输出。',
  'CLI-CN-050': '统计 data.csv 的总行数并输出到标准输出。',
  'CLI-CN-051': '输出 syslog.txt 中所有包含独立单词 error 的行（区分大小写），保留原始行顺序。',
  'CLI-CN-053': '统计 logs/ 下所有层级扩展名为 .log 的普通文件总数，输出数字。',
  'CLI-CN-056': '将 config.txt 中所有 foo 替换为 bar，直接保存到原文件。',
};

const scenarios = Object.entries(fixtures).map(([sourceId, executionCases]) => {
  const source = bank.find((item) => item.id === sourceId);
  if (!source) throw new Error(`Missing original scenario: ${sourceId}`);
  const scenario = { ...source, id: `${sourceId}-DOCKER`, status: 'valid', tier: 'private_dev',
    scenarioVersion: '2.1.0', responseMode: 'live_execution', reviewStatus: 'unreviewed',
    promptTemplate: `在 /workspace 中执行任务。环境为 Alpine/BusyBox，提供 POSIX sh 和 Python 3 标准库，不提供 bash 或 GNU 工具；提交脚本统一以 sh 执行。${prompts[sourceId]}只输出可执行 shell 脚本。`,
    requirements: { executionImage: image, executionImageId: imageId, executionInterpreter: 'sh', executionCases,
      migrationSourceId: sourceId, developmentShadow: true },
    scoring: { type: 'cli_command', mode: 'executed_state' },
  };
  scenario.scenarioHash = hashScenarioShort(scenario);
  return scenario;
});

fs.writeFileSync('data/pilots/cli-original-docker-v1.json', `${JSON.stringify(scenarios, null, 2)}\n`);
console.log(`Wrote ${scenarios.length} original CLI Docker development scenarios`);
