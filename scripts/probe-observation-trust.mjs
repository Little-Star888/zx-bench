import { probeObservationTrust } from '../packages/core/dist/evaluationLab/observationTrust.js';
const report = await probeObservationTrust();
console.log(JSON.stringify(report, null, 2));
// This is a reproduction, NOT a release gate: success means all known-bad
// drivers reproduced the vulnerability with working positive/negative controls.
if (report.results.some(r => r.status !== 'self_report_forgery_reproduced')) process.exitCode = 1;
