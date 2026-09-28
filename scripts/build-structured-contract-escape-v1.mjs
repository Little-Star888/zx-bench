// Small paired adaptation of SchemaBench Escape Translation. No model calls.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';

const source = 'data/pilots/schemabench-source/translation-selected.json';
const v3 = process.argv.includes('--v3'), v2 = v3 || process.argv.includes('--v2');
const version = v3 ? 3 : v2 ? 2 : 1;
const root = `data/pilots/structured-contract-escape-v${version}`;
const selectedSource = JSON.parse(fs.readFileSync(source, 'utf8'));
const rows = selectedSource.rows;
const selections = v2 ? {development: [635], holdout: [95]} : {development: [61, 81], holdout: [95]};
const sha = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fixtures = {
  61: token => ({locators: [{type: 'ElementSelector', selector: '#app'}], name: token}),
  81: token => ({key: 'k', secret: 's', src: token}),
  95: token => ({body: 'notice', event_type: 'announcement', last_updated: token, title: 'Notice',
    date: '2026-09-26', org: {id: 1, name: 'Example'}, id: 1}),
  635: token => ({name: 'My Token List', timestamp: '2026-09-26T00:00:00Z',
    version: {major: 1, minor: 0, patch: 0},
    tokens: [{chainId: 1, address: `0x${'a'.repeat(40)}`, decimals: 18, name: 'USD Coin', symbol: 'USDC'}],
    logoURI: token})
};
const field = {61: 'name', 81: 'src', 95: 'last_updated', 635: 'logoURI'};
const all = [], gold = [];
for (const [split, indices] of Object.entries(selections)) for (const index of indices) {
  const sourceRow = rows[index];
  if (sourceRow.model_schema.$schema !== 'http://json-schema.org/draft-07/schema#')
    throw Error(`Unsupported original dialect at ${index}`);
  if (sourceRow.verify_schema.properties?.[field[index]]?.const !== sourceRow.special_token)
    throw Error(`Token insertion path changed at ${index}`);
  for (const variant of ['base', 'structured']) {
    const id = `SCE${version + 5}-${String(index).padStart(3, '0')}-${variant.toUpperCase()}`;
    const schema = variant === 'base' ? {type: 'object', properties: {token: {type: 'string'}},
      required: ['token'], additionalProperties: false} : sourceRow.model_schema;
    const expected = variant === 'base' ? {token: sourceRow.special_token} : fixtures[index](sourceRow.special_token);
    const pointer = variant === 'base' ? '/token' : `/${field[index]}`;
    const requirements = {format: 'json', dialect: 'draft-07', schema, formatAssertions: true,
      assertions: [{pointer, expected: sourceRow.special_token, description: 'Decoded special token matches exactly'}],
      family: `schemabench_escape_${variant}`, pairId: `SCE${version + 5}-${String(index).padStart(3, '0')}`,
      pairVariant: variant, sourceGroup: `schemabench-escape:${index}`, output_policy: 'raw_only',
      provenance: {sourcePack: 'SchemaBench Escape Translation', sourceIndex: index,
        originalLicense: 'SchemaBench repository Apache-2.0; upstream schema licensing may vary',
        adaptation: 'Same token in base JSON and original real-world schema; token path required by explicit assertion'}};
    const prompt = variant === 'base' ?
      `Output one JSON object with exactly one field, token, whose decoded string equals the special token below. Return only JSON.\n\nSpecial token:\n${sourceRow.special_token}\n\nJSON Schema:\n${JSON.stringify(schema)}` :
      `Generate a valid JSON object under the real-world schema below. Put the special token in the ${v3 ? `top-level /${field[index]} field only` : `${field[index]} field`} exactly, preserving the decoded characters. Include the field even when the schema lists it as optional.${v3 ? ' Do not copy the token into any other field; all other fields must satisfy their own constraints.' : ''} Return only JSON.\n\nSpecial token:\n${sourceRow.special_token}\n\nJSON Schema:\n${JSON.stringify(schema)}`;
    const scenario = {id, dimension: 'structured_output', category: 'frontier_escape_translation',
      difficulty: 'unverified', language: 'json', locale: 'en-US', status: 'valid', tier: 'private_validation',
      promptTemplate: prompt, grader: 'structured_contract', graderVersion: 'structured_contract_v2',
      scenarioVersion: '1.0.0', scoring: {type: 'schema_compliance'}, requirements,
      outputPolicy: 'raw_only', reviewStatus: 'source_adapted_unverified',
      goldSource: 'Original SchemaBench model_schema and special_token; local valid witness', goldVerifiedAt: null,
      tags: [`structured-contract-escape-v${version}`, 'paired-development', 'official-method-adapted']};
    scenario.scenarioHash = hashScenarioShort(scenario);
    all.push({split, scenario}); gold.push({id, split, pairId: requirements.pairId, variant, raw: JSON.stringify(expected)});
  }
}
const development = all.filter(x => x.split === 'development').map(x => x.scenario);
const holdout = all.filter(x => x.split === 'holdout').map(x => x.scenario);
const manifest = {version: `structured-contract-escape-v${version}`, status: 'development-only',
  counts: {development: development.length, holdout: holdout.length},
  source: {dataset: 'SchemaBench Escape Translation', officialRepo: 'https://github.com/thunlp/SchemaReinforcementLearning',
    mirror: 'https://huggingface.co/datasets/kimddalko/SchemaBench', sourceSha256: selectedSource.sourceSha256, indices: selections},
  pairPolicy: 'Base and challenge share token; challenge uses original real-world schema. Distinct source schemas in development and holdout.',
  hashes: {development: sha(development), holdout: sha(holdout), gold: sha(gold)}, modelCalls: 0};
fs.mkdirSync(root, {recursive: true});
for (const [name, value] of Object.entries({'development.json': development, 'holdout.json': holdout,
  'gold.private.json': gold, 'manifest.json': manifest}))
  fs.writeFileSync(`${root}/${name}`, JSON.stringify(value, null, 2) + '\n');
fs.writeFileSync(`${root}/LICENSE-NOTICE.md`, `# Source attribution\n\nThis development pack adapts records ${[...selections.development,...selections.holdout].join(', ')} from the [SchemaBench Escape Translation](https://github.com/thunlp/SchemaReinforcementLearning) release. The official repository uses Apache-2.0; individual upstream schemas may have separate licenses and must be reviewed before redistribution. The source rows were downloaded from an unofficial [Hugging Face mirror](https://huggingface.co/datasets/kimddalko/SchemaBench). The paired tasks and mandatory token-path check are local adaptations; scores are not official SchemaBench scores.\n`);
console.log(JSON.stringify({counts: manifest.counts, indices: selections, hashes: manifest.hashes}));
