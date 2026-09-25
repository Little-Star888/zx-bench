# Changelog

All notable changes to ZxBench are documented here.

## [0.2.2] — 2026-09-26

### Current benchmark and evaluation reliability

- Update the released bank to **1.47.0**: 815 valid questions in 11 dimensions, including nine explicit-only development-shadow questions; a default run selects 806.
- Preserve frozen question packs and run constraints. Progressive four-part questions now carry their actual prior prompts and model answers in order, including during controlled replay.
- Distinguish model failures from execution-environment and Judge failures. Audit stored scores and rule/Judge conflicts, and keep runs with incomplete scoring off the leaderboard.
- Preflight the selected Judge before starting a run; improve batch monitoring and keep run-level token limits effective for each question.
- Publish the [five-model evaluation report](analysis/swift-five-model-report/Swift与五模型全维度测评报告-20260925.md) with figures, common-question methodology, and item-level format adjudications. Its 801-question comparison is a historical analysis, not the current default run.

### Hotfix

- Restore all 20 pre-existing multi-file long tasks to formal scope: benchmark 1.31.1 runs 620 questions, including 150 programming questions.
- Make `benchmark.json` the only released import catalogue. Development fixtures and historical CR2 subsets are no longer imported as formal questions.
- On upgrade, retire only accidentally imported bundled-history rows while preserving user-created custom questions and historical result rows.
- Bind official-run selection and dashboard counts to the released catalogue, and reject same-ID database definitions whose frozen content hash is out of sync.

## [0.2.1] — 2026-09-13

### Hotfix

- Restore the released **正式评测** flow: the 580 frozen, score-bearing public scenarios are now accepted; 20 explicitly marked multi-file development-shadow scenarios remain excluded from the main score.
- Normalize `goldVerifiedAt` before scenario hashing, so SQLite/Prisma date round-trips cannot falsely report a frozen definition as modified.
- Synchronize the local 600-scenario definition store without altering historical runs or result rows, and add API/contract regression coverage for the released flow.

## [0.2.0] — 2026-09-13

### Highlights

- Publish benchmark 1.30.0: 600 active definitions across 10 dimensions, with 78 retired scenarios retained as versioned archive material.
- Add five prospective-only, deterministic challenge questions for hallucination resistance and mathematical reasoning. They use strict JSON contracts and no Judge calls.
- Complete the trusted single-file programming migration: 107 repair scenarios, 345 frozen verification IDs, and two executable-evidence PR scenarios.
- Expand and freeze the data-extraction suite at 56 typed JSON-contract scenarios.
- Repair real-time monitor card contrast in dark mode.

### Reliability boundaries

- Multi-file `project_repair` scenarios remain explicit-only development shadow tasks. JavaScript, Python, and Go maintainer risk samples have replayed positive gold; C#, Rust, and SQL remain pending and do not affect official scores.
- `MC2-004-R1` is a redesigned development candidate, not part of benchmark 1.30.0 or historical score comparisons.
- Complete fenced JSON is no longer misclassified as truncated; genuinely unclosed fences remain rejected.

### Validation

- Automated unit and contract regression tests cover the release changes. Container-backed gold replay verifies the initial JavaScript, Python, and Go multi-file risk sample.
