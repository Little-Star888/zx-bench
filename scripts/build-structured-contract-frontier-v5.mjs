// Source-disjoint paired format pilot from T2S-Bench-MR. No model calls.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';

const root = 'data/pilots/structured-contract-frontier-v5';
const source = 'data/pilots/t2s-mr-source/rows-0-99.json';
const raw = fs.readFileSync(source);
const rows = new Map(JSON.parse(raw).rows.map(x => [x.row_idx, x.row]));
const selections = {development: [0, 1, 20, 23, 29, 38, 60, 87], holdout: [40, 42, 45, 63]};
const sha = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const shaBytes = x => createHash('sha256').update(x).digest('hex');
const all = [], oracles = {}, gold = [];
const papers = new Set();
for (const [split, indices] of Object.entries(selections)) for (const index of indices) {
  const row = rows.get(index);
  if (!row || papers.has(row.paper_title)) throw Error(`Missing or repeated source paper ${index}`);
  papers.add(row.paper_title);
  const answer = row.answer.replaceAll(' ', '');
  if (!/^[A-D](,[A-D])*$/.test(answer)) throw Error(`Unexpected official answer ${index}: ${answer}`);
  const selected = answer.split(',');
  if (selected.join(',') !== [...new Set(selected)].sort().join(',')) throw Error(`Unsorted official answer ${index}`);
  const frame = JSON.parse(row.reference_frame);
  if (!Array.isArray(frame.nodes) || !Array.isArray(frame.links)) throw Error(`Missing reference frame ${index}`);
  const sourceId = `t2s-mr:${row.pid}`;
  const sourceText = `${row.text}\n\nDiagram transcription (nodes and directed links):\n${JSON.stringify(frame)}`;
  const common = `Read the paper excerpt and diagram transcription, then answer the multiple-choice question using only the supplied material. The diagram links are directed. Select every correct option; list letters in alphabetical order.\n\nPaper: ${row.paper_title}\n\nSource:\n${sourceText}\n\nQuestion:\n${row.question}\n\n`;
  for (const variant of ['base', 'structured']) {
    const id = `SOC4-T2S-${String(index).padStart(3, '0')}-${variant.toUpperCase()}`;
    const expected = variant === 'base' ? {selected_options: answer} : {
      option_decisions: Object.fromEntries('ABCD'.split('').map(letter => [letter, selected.includes(letter)])),
      selected_options: answer, selected_count: selected.length
    };
    const schema = variant === 'base' ? {
      type: 'object', properties: {selected_options: {type: 'string', pattern: '^[A-D](,[A-D])*$'}},
      required: ['selected_options'], additionalProperties: false
    } : {
      type: 'object', properties: {
        option_decisions: {type: 'object', properties: Object.fromEntries('ABCD'.split('').map(letter => [letter, {type: 'boolean'}])),
          required: ['A', 'B', 'C', 'D'], additionalProperties: false},
        selected_options: {type: 'string', pattern: '^[A-D](,[A-D])*$'},
        selected_count: {type: 'integer', minimum: 1, maximum: 4}
      }, required: ['option_decisions', 'selected_options', 'selected_count'], additionalProperties: false
    };
    const oracle = {expected, sources: {[sourceId]: sourceText},
      provenance: Object.fromEntries((variant === 'base' ? ['/selected_options'] :
        ['/option_decisions/A', '/option_decisions/B', '/option_decisions/C', '/option_decisions/D', '/selected_options', '/selected_count'])
        .map(path => [path, [sourceId]]))};
    const req = {format: 'json', dialect: '2020-12', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', ...schema},
      formatAssertions: true, family: `t2s_${row.question_class.toLowerCase().replaceAll(' ', '_')}`,
      challengeFamily: `T2S_${row.question_class.toUpperCase().replaceAll(' ', '_')}`,
      pairId: `T2S-${String(index).padStart(3, '0')}`, pairVariant: variant,
      sourceGroup: row.paper_title, output_policy: 'raw_only', oracleSet: 'frontier-v5', oracleRef: id,
      oracleHash: sha(oracle), provenance: {sourcePack: 'T2S-Bench-MR', pid: row.pid, paperTitle: row.paper_title,
        originalLicense: 'Apache-2.0', adaptation: 'Diagram reference frame rendered as directed graph text; paired JSON outputs'}};
    const ending = variant === 'base' ?
      'Return one JSON object with only selected_options, for example {"selected_options":"A,C"}. Return no explanation.' :
      'Return one JSON object with option_decisions for A, B, C, D (each true or false), selected_options as sorted comma-separated letters, and selected_count. These fields must agree. Return no explanation.';
    const scenario = {id, dimension: 'structured_output', category: 'frontier_paired_graph_reasoning', difficulty: 'unverified',
      language: 'json', locale: 'en-US', status: 'valid', tier: 'private_validation', promptTemplate: common + ending +
        `\n\nJSON Schema:\n${JSON.stringify(req.schema)}`, grader: 'structured_contract', graderVersion: 'structured_contract_v4',
      scenarioVersion: '1.0.0', scoring: {type: 'schema_compliance'}, requirements: req, outputPolicy: 'raw_only',
      reviewStatus: 'source_adapted_unverified', goldSource: 'T2S-Bench-MR official answer', goldVerifiedAt: null,
      tags: ['structured-contract-frontier-v5', 'paired-development', 'official-source-adapted']};
    scenario.scenarioHash = hashScenarioShort(scenario);
    all.push({split, scenario}); oracles[id] = oracle;
    gold.push({id, split, pairId: req.pairId, variant, raw: JSON.stringify(expected), sourceIndex: index});
  }
}
const development = all.filter(x => x.split === 'development').map(x => x.scenario);
const holdout = all.filter(x => x.split === 'holdout').map(x => x.scenario);
const manifest = {version: 'structured-contract-frontier-v5-t2s-paired', status: 'development-only',
  counts: {development: development.length, holdout: holdout.length, pairsDevelopment: selections.development.length,
    pairsHoldout: selections.holdout.length}, source: {dataset: 'T2S-Bench-MR',
    url: 'https://huggingface.co/datasets/T2SBench/T2S-Bench-MR', split: 'train', license: 'Apache-2.0',
    downloadedRows: '0-99', downloadSha256: shaBytes(raw), rowIndices: selections},
  pairPolicy: 'Every base/structured pair uses identical source and question. Pairs, not individual variants, are split by paper. No model calls before freeze.',
  scoringPolicy: 'Official selected letters become the shared objective gold. Base tests answer correctness; structured adds per-option booleans and count. Only base-pass/structured-fail is a candidate structured-specific miss.',
  hashes: {development: sha(development), holdout: sha(holdout), oracle: sha(oracles), gold: sha(gold)}, modelCalls: 0};
fs.mkdirSync(root, {recursive: true});
for (const [name, value] of Object.entries({'development.json': development, 'holdout.json': holdout,
  'oracle.private.json': oracles, 'gold.private.json': gold, 'manifest.json': manifest}))
  fs.writeFileSync(`${root}/${name}`, JSON.stringify(value, null, 2) + '\n');
fs.writeFileSync(`${root}/LICENSE-NOTICE.md`, '# Source attribution\n\nPaired evaluation items adapt questions, answers, text, and reference frames from [T2S-Bench-MR](https://huggingface.co/datasets/T2SBench/T2S-Bench-MR), licensed Apache-2.0. Original paper titles and source PIDs are retained in each scenario. The diagram reference frame is serialized as text; scores on this adaptation are not official T2S-Bench scores.\n');
console.log(JSON.stringify({counts: manifest.counts, selections, hashes: manifest.hashes}));
