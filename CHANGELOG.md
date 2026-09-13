# Changelog

All notable changes to ZxBench are documented here.

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
