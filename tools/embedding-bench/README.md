# Embedding benchmark

This tool compares embedding candidates against the retrieval workload used by agent-qa's
memory engine. It is intended for questions such as:

- Does a new model retrieve the recorded memory corpus better than the current default?
- Does a new revision of the same model improve accuracy without an unacceptable cost?
- What model-load, embedding-throughput, memory, vector-size, and top-k trade-offs accompany
  an accuracy change?

The benchmark produces a machine-readable raw JSON report and a human-readable `REPORT.md`.
It does not change the production embedding profile.

## Runtime parity with production

Native candidates and the production memory engine both use the exact dependency
`@huggingface/transformers@4.2.0`, the latest stable Transformers.js release. The benchmark keeps
its own direct pin so a later Transformers.js release can be evaluated here before production
adopts it.

The adapter in `src/transformers-js-backend.ts` mirrors the production native embedding path:

- CPU `feature-extraction` pipeline
- candidate-pinned model revision and `q8` dtype
- production ONNX session options
- candidate token budget (explicit cap or backend/model default)
- candidate-declared mean or CLS pooling and L2 normalization
- separate query and document prefixes
- an output-dimension check
- the shared cache resolved from `AGENT_QA_MODEL_CACHE_DIR`

Transformers.js 4.2's high-level factory drops revision/offline options during its metadata
preflight. The adapter therefore constructs the same public `AutoTokenizer`, `AutoModel`, and
`FeatureExtractionPipeline` components directly, pins the metadata URL to the candidate commit for
online acquisition, and loads the exact revision directory with remote access disabled offline.

Every native candidate is measured in an isolated child process so process-lifetime model
sessions do not contaminate the next candidate's memory measurements. The `static` backend is
reserved for the bundled production degradation floor; Hugging Face candidates should use the
`node` backend. Static candidate identity, artifact, revision, dimensions, pooling, normalization,
and prefixes are schema-locked to that bundled Potion floor so reports cannot relabel its vectors.

## Prerequisites

- Node.js 24 or newer
- pnpm (the repository pins its version in the root `package.json`)
- Enough disk and memory for every selected model
- Network access for the first run, unless all pinned artifacts are already cached

From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter embedding-bench... --if-present build
```

The trailing `...` selects the benchmark and its workspace dependency closure.

## Configuration

`benchmark.config.json` controls comparison policy and performance sample sizes. Its schema is:

```json
{
  "schemaVersion": 1,
  "baselineCandidateId": "bge-small-en-v1.5",
  "floorCandidateId": "potion-retrieval-32m-static-floor",
  "selection": {
    "minimumRecordedHitAt5Gain": 0.03,
    "requireRecordedHitAt1NonRegression": true,
    "maximumFloorHitAt5Gap": 0.1
  },
  "performance": {
    "singleDocumentSamples": 20,
    "concurrentDocumentSamples": 200,
    "concurrency": 16,
    "topK": 5,
    "topKIterations": 25
  },
  "languageMix": "English-only validated; multilingual unbenched."
}
```

`baselineCandidateId` must name a `node` candidate. `floorCandidateId` may be `null`; otherwise it
must name a `static` candidate. Selection values are fractions, so `0.03` means three absolute
percentage points. Performance values are positive integers; `concurrency` and `topK` cannot
exceed `concurrentDocumentSamples`. `languageMix` records the scope to which the result applies.

`candidates.json` is a nonempty array. Each candidate has this runtime shape:

```json
{
  "id": "bge-small-en-v1.5",
  "model_id": "Xenova/bge-small-en-v1.5",
  "backend": "node",
  "artifact": "hugging-face-hub",
  "revision": "ea104dacec62c0de699686887e3f920caeb4f3e3",
  "dtype": "q8",
  "dim": 384,
  "pooling": "mean",
  "normalize": true,
  "max_tokens": 512,
  "query_prefix": "Represent this sentence for searching relevant passages: ",
  "doc_prefix": ""
}
```

Candidate IDs must be unique and may contain letters, digits, dots, underscores, and hyphens.
`revision` must be a full 40-character lowercase immutable commit SHA, not a moving branch or tag. The current schema
deliberately fixes `dtype` and normalization to the production contract (`q8` and `true`) while
allowing `pooling` to be `mean` or `cls`. Pooling is part of the model contract, not a tuning knob:
the BGE baseline uses mean pooling, while the GTE ModernBERT and Granite candidates use CLS pooling
as specified by their official configurations/examples. Extra provenance fields such as
`prefixValidation` and `dtypePrevalidation` are retained in reports.

`max_tokens` is either a positive explicit cap or `null` to retain the backend/model default. The
checked-in BGE candidate uses 512; GTE ModernBERT and Granite use their 8,192-position model limit;
the bundled static floor uses `null`, matching its uncapped production path.

### Add a model

1. Add a `node` entry to `candidates.json` with a unique safe ID.
2. Pin the exact Hugging Face repository and full revision SHA.
3. Confirm that a `q8` artifact is available at that revision.
4. Copy the model card's retrieval prefixes and pooling mode exactly, then set the real output
   dimension and token cap. A wrong dimension fails the candidate instead of silently producing
   incomparable data.
5. Run validation, then benchmark the candidate. The configured baseline and degradation floor
   are included automatically for a complete policy comparison.

```sh
pnpm --filter embedding-bench bench:validate
pnpm --filter embedding-bench bench -- \
  --candidate my-new-model \
  --report tools/embedding-bench/reports/bench-report-my-new-model.json
```

### Compare another revision of an existing model

Duplicate the existing candidate, give the copy a new ID such as
`bge-small-en-v1.5-rev-2026-08`, and replace only the fields that actually changed, especially the
full `revision` SHA. Keep the old entry while benchmarking so both revisions remain auditable.
Do not move the production pin merely because the new revision loads successfully; use the
retrieval and cost results to make that decision.

A selected benchmark default is a recommendation, not an automatic deployment. Production must
first support the candidate's exact pooling mode, prefixes, token cap, dimension, dtype, and
normalization. In particular, a CLS-pooled winner cannot be substituted into the current
mean-only production profile without updating and testing that production contract.

## Commands

Run all commands from the repository root. The default input paths are resolved relative to this
tool, so the CLI itself is independent of the current working directory.

For run mode, `--report` names the raw `.json` report; the CLI writes `REPORT.md` beside it and
rejects output paths that would overwrite either artifact or any benchmark input. Merge mode
likewise refuses to overwrite one of its raw input reports.

Validate configuration, candidate schema, cross-references, and benchmark runtime without loading
a model:

```sh
pnpm --filter embedding-bench bench:validate
```

List candidate ID, model, revision, and backend as TSV without loading a model:

```sh
pnpm --filter embedding-bench bench:list
```

Run all candidates, including accuracy and hardware-dependent constants:

```sh
pnpm --filter embedding-bench bench -- \
  --report tools/embedding-bench/reports/bench-report-local.json
```

Run one or more candidates. `--candidate` is repeatable and preserves manifest order. The
configured baseline and degradation floor are automatically added unless `--no-baseline` is
supplied:

```sh
pnpm --filter embedding-bench bench -- \
  --candidate granite-embedding-small-english-r2 \
  --candidate gte-modernbert-base \
  --report tools/embedding-bench/reports/bench-report-subset.json

# Diagnostic run with exactly the requested candidate; usually less useful for selection.
pnpm --filter embedding-bench bench -- \
  --candidate granite-embedding-small-english-r2 \
  --no-baseline \
  --report tools/embedding-bench/reports/bench-report-granite-only.json
```

Run retrieval accuracy only, skipping model-load, throughput, RSS, vector-store, and top-k timing
measurements:

```sh
pnpm --filter embedding-bench bench -- \
  --accuracy-only \
  --report tools/embedding-bench/reports/bench-report-accuracy.json
```

Run without network access. All selected native revisions must already exist in the shared cache:

```sh
AGENT_QA_MODEL_CACHE_DIR=/absolute/path/to/agent-qa-models \
  pnpm --filter embedding-bench bench -- \
  --offline \
  --report tools/embedding-bench/reports/bench-report-offline.json
```

Override any or all inputs with `--config`, `--candidates`, `--corpus`, `--corpus-manifest`, and
`--authored-queries`:

```sh
pnpm --filter embedding-bench bench -- \
  --config /tmp/embedding-bench/benchmark.config.json \
  --candidates /tmp/embedding-bench/candidates.json \
  --corpus /tmp/embedding-bench/corpus.json \
  --corpus-manifest /tmp/embedding-bench/corpus-manifest.json \
  --authored-queries /tmp/embedding-bench/authored-queries.json \
  --report /tmp/embedding-bench/bench-report.json
```

The same `--config` and `--candidates` overrides can be passed to `bench:validate` or `bench:list`.

Merge raw reports from unique platform/architecture pairs into one cross-platform Markdown
report:

```sh
pnpm --filter embedding-bench bench -- \
  --merge \
  --report tools/embedding-bench/reports/REPORT.md \
  /tmp/embedding-bench/bench-report-darwin-arm64-v2.json \
  /tmp/embedding-bench/bench-report-linux-x64-v2.json \
  /tmp/embedding-bench/bench-report-win32-x64-v2.json
```

Merge validates the schema-v2 raw reports and rejects incompatible evidence rather than silently
combining it. A merge requires full reports with successful accuracy and performance measurements
for every included candidate; accuracy-only reports and reports containing candidate errors remain
useful individually but are not merge inputs. Keep the raw JSON files: the merged Markdown links
each input to its SHA-256 digest. The checked-in July 2026 reports are legacy schema-v1 evidence and
cannot be merged into schema-v2 output; they also used the wrong mean pooling for GTE and Granite.

Rebuild the recorded corpus from one or more cassette roots:

```sh
pnpm --filter embedding-bench build-corpus -- \
  --cassette-root /absolute/path/to/first/cassettes \
  --cassette-root /absolute/path/to/second/cassettes \
  --out tools/embedding-bench/corpus

pnpm --filter embedding-bench bench:validate
```

The builder recursively finds `cassette.json`, emits `corpus.json` and
`corpus-manifest.json`, and records source hashes. Review and commit both generated files together
when intentionally changing the benchmark population.

## Reading a report

Use the raw JSON as the evidence record and `REPORT.md` as its review view.

- **Recorded retrieval** is the primary cassette-derived slice. Per-app rows expose regressions
  hidden by aggregation; the macro row gives every app equal weight.
- **Authored retrieval** is a separate reviewed fixture slice. It is useful supporting evidence
  and is not blended into the recorded score.
- **hit@1 / hit@3 / hit@5** are the fractions of queries with at least one gold document in the
  first 1, 3, or 5 results.
- **Gold-pair and random-pair cosine distributions** show score separation. The proposed
  `tau_dense` is the fifth percentile of recorded gold-pair cosine, rounded down to two decimals.
- **Performance constants** include time to the first completed embedding (imports, cached load,
  session setup, and warm-up inference), single-document throughput and p50/p95
  latency, concurrent throughput, RSS growth, bytes per vector, and brute-force/vec0 top-k time.
  They are absent in an accuracy-only run.
- **Mechanical verdict** applies the thresholds in `benchmark.config.json`. A winning score on
  this corpus is evidence for this workload, not a universal model ranking. Dimension and model
  size remain deployment costs even when retrieval improves.

Performance numbers are hardware- and OS-dependent. Compare candidates within the same raw
platform report; use a merge to inspect whether conclusions hold across platforms.

> **A candidate error is not evidence of poor model quality.** A report can preserve failures
> caused by a cold offline cache, unavailable artifact or dtype, network failure, incompatible
> runtime, bad revision, incorrect dimension, or insufficient memory. Fix the operational error
> and obtain a successful comparable run before drawing a quality conclusion. If the baseline
> fails—or any selected candidate is incomplete—the selection verdict is indeterminate. The CLI
> still writes the diagnostic report but exits nonzero so CI cannot mistake it for valid evidence.

## Reproducibility

- Keep `@huggingface/transformers` exact, not ranged, and record any upgrade as a benchmark input
  change.
- Pin every model to a full revision SHA. Treat a new upstream revision as a new candidate until
  it has been compared.
- Use the same `AGENT_QA_MODEL_CACHE_DIR` as production. An online warm-up can populate it; an
  `--offline` rerun proves the pinned artifacts are actually available locally.
- Keep candidate, config, corpus, corpus-manifest, and authored-query files with the raw report.
  Their paths and SHA-256 hashes are recorded in schema-v2 output.
- Preserve the recorded execution policy. Schema-v2 reports distinguish downloads-allowed runs
  from offline-cache-only proof and record whether performance measurement was skipped.
- Re-run on each target platform. Raw timing and RSS values cannot be compared meaningfully across
  different machines without preserving the runtime metadata in each report.
- Preserve candidate failures as data, but do not ratify or reject a model until its required
  measurements completed successfully.

The manually dispatched GitHub Actions workflow runs validation first, uses Node 24, caches pinned
model artifacts by benchmark inputs, and uploads both raw JSON and Markdown for Linux and Windows.
It is an evidence-producing workflow, not a pull-request gate.
