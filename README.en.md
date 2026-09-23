# ZxBench · Local LLM Evaluation Platform

[中文](README.md) · English

[![CI](https://github.com/suncityldp/zx-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/suncityldp/zx-bench/actions/workflows/ci.yml)

ZxBench is a locally deployed LLM evaluation platform with a versioned question bank, containerized programming tests, deterministic grading plus an optional AI Judge, live monitoring, resume, reports, and leaderboards. The current bank is **1.47.0**: **815 valid questions across 11 dimensions**. Nine are explicit-only development-shadow questions, leaving **806 questions in a default run**. Inclusion does not certify independent gold-answer review or discrimination across all models.

## Quick start

Requires Node.js ≥22.13 and pnpm ≥11. Programming tasks also require a running Docker installation. Prepare the language images required by the questions you run; a missing image is an environment problem, not evidence that the model failed.

```bash
pnpm install
pnpm --filter server prisma:generate
# Copy apps/server/.env.example to apps/server/.env and configure as needed
pnpm build
pnpm --filter server start
```

Open <http://127.0.0.1:3001>. Windows users can also use `start.bat`; use the pnpm command on macOS/Linux. On first use and after bank updates, run `node scripts/seed-benchmark.mjs` to import `data/scenarios/benchmark.json`. Importing preserves user-created questions and historical scores. Official runs are selected by the released question IDs and content hashes, not by every old database row.

## Question bank and scoring

Counts below are valid definitions from `data/scenarios/benchmark-meta.json`, **not necessarily completed questions in a particular run**. A default run excludes nine development-shadow questions (`MC2-004-R1` and the four parts each of `UMX-01/02`). Dimension or question filters, and interrupted runs, change the actual coverage.

| Dimension | Valid questions | Composite weight |
|---|---:|---:|
| `program` | 150 | 0.17 |
| `hallucination_resistance` | 134 | 0.12 |
| `reasoning_math` | 115 | 0.12 |
| `data_extraction` | 104 | 0.07 |
| `structured_output` | 58 | 0.05 |
| `cli_deep_tasks` | 56 | 0.07 |
| `tool_cli_workflow` | 56 | 0.07 |
| `safety_authority` | 50 | 0.10 |
| `agent_workflow` | 45 | 0.08 |
| `instruction_following` | 42 | 0.12 |
| `agent_loop` | 5 | 0.03 |
| **Total** | **815** | **1.00** |

Question scores are weighted by difficulty (easy 1, medium 1.5, hard 2, adversarial 2.5), averaged within each dimension, and combined using the weights above. Deterministic graders handle verifiable properties; an AI Judge can grade semantic items under question-specific rules. Missing grades and execution-environment errors must be reported separately, not silently treated as model failures. Retries use the latest eligible attempt in the question's attempt chain. Totals from different bank versions, question selections, or run conditions are not directly comparable.

Exact-answer math questions also record a separate **`content_accuracy`** diagnostic when the answer's substance can be independently checked. It can show that the content is correct even when an `ANSWER:` formatting requirement is violated. This diagnostic **does not affect the composite score**: format violations still incur their official penalty. Unmeasurable questions are not assumed correct. A historical result can receive the diagnostic only when its question content hash matches the current definition.

Programming includes single-file repair, no-bug traps, and multi-file project tasks. `code_repair@4.14.0` covers 107 repair questions with 345 frozen formal test IDs. Candidate programs run in network-isolated, resource-limited containers or bounded compiler processes; expected results remain with the host. Multi-file tasks remain in formal scope, but positive-gold coverage is incomplete for some tasks. Container isolation and passing tests do not certify arbitrary repository semantics or security against malicious code. See [release gate and limitations](docs/lightweight-release-gate.md).

## Running and verifying evaluations

- Create a single-model run or a batch of up to eight distinct models; each model has an independent run. Question concurrency is 1–4, default 4.
- Reasoning models can use a larger generation budget, reasoning cap, and per-question deadline. Run-level `Max Tokens` is a hard request cap; question-level constraints can only lower it. Configure it within the model server's context and output limits, and distinguish timeouts or environment errors from capability results.
- Live monitoring supports pause, resume, cancel, and question retry. Reports and leaderboards expose dimension scores and evidence. Batch monitoring lets you switch between models.
- Use `pnpm --filter server run:verify-score <run-id> [database-url]` for a read-only check of the frozen bank, primary question results, dimension scores, and total. Add `--repair-summary` only when intentionally repairing an older cached summary; that operation first backs up the database.
- `pnpm test` runs regression tests; `pnpm test:containers` runs Docker-dependent positive/negative checks; `pnpm build` verifies the frontend and backend builds. CI installs dependencies, generates Prisma, builds, then tests on push/PR.

For methods and limitations, see [evaluation reliability](docs/evaluation-reliability-implementation-2026-09-09.md), [integrity fixes](docs/evaluation-integrity-fixes-2026-09.md), and [bank review](docs/reviewed-question-bank-v5.md). Older release details remain in `docs/` and should not be read as the current bank size or scoring rules.

## Repository layout

```text
apps/web/        React frontend
apps/server/     Fastify API, Prisma, WebSocket
packages/core/   Model calling, execution, scoring, reports
packages/types/  Shared types
data/scenarios/  Current bank, metadata, archives, development questions
scripts/         Bank import, export, and audit tools
docs/            Methods and screenshots
```

MIT License · Copyright (c) 2026 ZhiXiu Contributors
