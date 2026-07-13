# Embedding Benchmark Report

Generated: 2026-07-13T21:43:01.999Z

Platform: merged evidence — macos-arm64 informative; ubuntu-latest/linux-x64 and windows-latest/win-x64 canonical

### Raw Platform Reports

| Environment | Path | SHA-256 | Generated |
|---|---|---|---|
| macos-arm64 (informative) | reports/bench-report-macos-arm64.json | `0a7dac26a4911af49979c638d1a8dab33524f7d1e6a8bead2cd39063993f57fe` | 2026-07-13T21:13:43.533Z |
| ubuntu-latest/linux-x64 (canonical) | reports/bench-report-ubuntu-latest.json | `219650c824f1b41154ab3d7cfcef8d15e54202ff31942598f97bf972788af8d7` | 2026-07-13T21:36:52.943Z |
| windows-latest/win-x64 (canonical) | reports/bench-report-windows-latest.json | `5737a55b5d766a98745b157b6bfc6dc638657618fef1e9e02211caff92d3a3ac` | 2026-07-13T21:39:34.511Z |

## Corpus Manifest Summary

Builder: 376.08.1

Documents: 2018; recorded queries: 49; authored queries: 32; source cassettes: 76.

| App | Documents | Recorded queries |
|---|---:|---:|
| apple-maps | 780 | 12 |
| automation-exercise | 454 | 6 |
| example-web | 559 | 5 |
| google-maps | 225 | 26 |

### Input Provenance

| Input | Path | SHA-256 |
|---|---|---|
| candidates | tools/embedding-bench/candidates.json | `58e46bdeba42ede6c2421368179156da2df5642afad37d645714a89012537641` |
| corpus | tools/embedding-bench/corpus/corpus.json | `60ef8d2931cea95367d4095ac7d92b113a01d990f5bdc7ff7060cf26b40a5a38` |
| corpusManifest | tools/embedding-bench/corpus/corpus-manifest.json | `b75f442cd4b75465e013eca17e782fb4c7611a29407b610ff716fa115458bc07` |
| authoredQueries | tools/embedding-bench/fixtures/authored-queries.json | `925ade87744685eb452c9ccf3648aed46dd036f7baa20cb66c9774a195dc636b` |

### Candidate Pins

| Candidate | Model | Revision | Backend | Dim | Dtype | Max tokens |
|---|---|---|---|---:|---|---:|
| bge-small-en-v1.5 | Xenova/bge-small-en-v1.5 | `ea104dacec62c0de699686887e3f920caeb4f3e3` | node | 384 | q8 | 512 |
| gte-modernbert-base | Alibaba-NLP/gte-modernbert-base | `e7f32e3c00f91d699e8c43b53106206bcc72bb22` | node | 768 | q8 | 512 |
| granite-embedding-small-english-r2 | onnx-community/granite-embedding-small-english-r2-ONNX | `1dc7835ba0cb9c76a3618d0bf0c427c97671b3c8` | node | 384 | q8 | 512 |
| potion-retrieval-32m-static-floor | minishlab/potion-retrieval-32M | `6fc8051fab2a1e0ee76689cf08c853792ac285e7` | static | 512 | q8 | 512 |

## Recorded Slice hit@k

This primary cassette-derived slice is reported independently and drives the mechanical verdict.

| Candidate | Scope | Queries | hit@1 | hit@3 | hit@5 |
|---|---|---:|---:|---:|---:|
| bge-small-en-v1.5 | apple-maps | 12 | 0.00% | 0.00% | 0.00% |
| bge-small-en-v1.5 | automation-exercise | 6 | 50.00% | 100.00% | 100.00% |
| bge-small-en-v1.5 | example-web | 5 | 100.00% | 100.00% | 100.00% |
| bge-small-en-v1.5 | google-maps | 26 | 0.00% | 7.69% | 7.69% |
| bge-small-en-v1.5 | **macro** | 49 | 37.50% | 51.92% | 51.92% |
| gte-modernbert-base | apple-maps | 12 | 0.00% | 0.00% | 0.00% |
| gte-modernbert-base | automation-exercise | 6 | 0.00% | 0.00% | 0.00% |
| gte-modernbert-base | example-web | 5 | 100.00% | 100.00% | 100.00% |
| gte-modernbert-base | google-maps | 26 | 0.00% | 0.00% | 0.00% |
| gte-modernbert-base | **macro** | 49 | 25.00% | 25.00% | 25.00% |
| granite-embedding-small-english-r2 | apple-maps | 12 | 0.00% | 0.00% | 0.00% |
| granite-embedding-small-english-r2 | automation-exercise | 6 | 50.00% | 50.00% | 50.00% |
| granite-embedding-small-english-r2 | example-web | 5 | 100.00% | 100.00% | 100.00% |
| granite-embedding-small-english-r2 | google-maps | 26 | 0.00% | 7.69% | 7.69% |
| granite-embedding-small-english-r2 | **macro** | 49 | 37.50% | 39.42% | 39.42% |
| potion-retrieval-32m-static-floor | apple-maps | 12 | 0.00% | 0.00% | 16.67% |
| potion-retrieval-32m-static-floor | automation-exercise | 6 | 0.00% | 50.00% | 50.00% |
| potion-retrieval-32m-static-floor | example-web | 5 | 100.00% | 100.00% | 100.00% |
| potion-retrieval-32m-static-floor | google-maps | 26 | 0.00% | 7.69% | 7.69% |
| potion-retrieval-32m-static-floor | **macro** | 49 | 25.00% | 39.42% | 43.59% |

## Authored Slice hit@k

Provenance: slice=authored; drafting=LLM-drafted; reviewStatus=human-review-pending; reviewGate=Phase 376 Plan 11 D-03 ratification. This augmentation is never merged with the recorded slice.

| Candidate | Scope | Queries | hit@1 | hit@3 | hit@5 |
|---|---|---:|---:|---:|---:|
| bge-small-en-v1.5 | apple-maps | 8 | 0.00% | 0.00% | 0.00% |
| bge-small-en-v1.5 | automation-exercise | 8 | 25.00% | 50.00% | 50.00% |
| bge-small-en-v1.5 | example-web | 8 | 37.50% | 62.50% | 75.00% |
| bge-small-en-v1.5 | google-maps | 8 | 0.00% | 37.50% | 37.50% |
| bge-small-en-v1.5 | **macro** | 32 | 15.63% | 37.50% | 40.63% |
| gte-modernbert-base | apple-maps | 8 | 0.00% | 12.50% | 12.50% |
| gte-modernbert-base | automation-exercise | 8 | 0.00% | 12.50% | 25.00% |
| gte-modernbert-base | example-web | 8 | 25.00% | 37.50% | 62.50% |
| gte-modernbert-base | google-maps | 8 | 12.50% | 50.00% | 50.00% |
| gte-modernbert-base | **macro** | 32 | 9.38% | 28.13% | 37.50% |
| granite-embedding-small-english-r2 | apple-maps | 8 | 12.50% | 12.50% | 12.50% |
| granite-embedding-small-english-r2 | automation-exercise | 8 | 12.50% | 12.50% | 12.50% |
| granite-embedding-small-english-r2 | example-web | 8 | 25.00% | 50.00% | 87.50% |
| granite-embedding-small-english-r2 | google-maps | 8 | 12.50% | 50.00% | 75.00% |
| granite-embedding-small-english-r2 | **macro** | 32 | 15.63% | 31.25% | 46.88% |
| potion-retrieval-32m-static-floor | apple-maps | 8 | 0.00% | 12.50% | 12.50% |
| potion-retrieval-32m-static-floor | automation-exercise | 8 | 25.00% | 37.50% | 37.50% |
| potion-retrieval-32m-static-floor | example-web | 8 | 50.00% | 62.50% | 62.50% |
| potion-retrieval-32m-static-floor | google-maps | 8 | 12.50% | 37.50% | 37.50% |
| potion-retrieval-32m-static-floor | **macro** | 32 | 21.88% | 37.50% | 37.50% |

## §5.1 Constants

| Candidate | Metric | macos-arm64 (informative) | ubuntu-latest/linux-x64 (canonical) | windows-latest/win-x64 (canonical) |
|---|---|---:|---:|---:|
| bge-small-en-v1.5 | Warm load ms | 159.419 | 430.817 | 687.871 |
| bge-small-en-v1.5 | Single docs/s | 69.245 | 24.840 | 22.528 |
| bge-small-en-v1.5 | Batch docs/s | 91.145 | 32.500 | 29.521 |
| bge-small-en-v1.5 | RSS MiB | 321.19 | 317.57 | 262.84 |
| bge-small-en-v1.5 | Brute top-k ms | 0.332068 | 0.538419 | 0.558436 |
| bge-small-en-v1.5 | vec0 top-k ms | 0.125105 | 0.207067 | 0.496580 |
| gte-modernbert-base | Warm load ms | 952.016 | 864.560 | 1214.233 |
| gte-modernbert-base | Single docs/s | 17.496 | 5.828 | 3.936 |
| gte-modernbert-base | Batch docs/s | 21.175 | 7.423 | 6.432 |
| gte-modernbert-base | RSS MiB | 618.42 | 554.43 | 449.28 |
| gte-modernbert-base | Brute top-k ms | 0.613762 | 0.966682 | 1.673552 |
| gte-modernbert-base | vec0 top-k ms | 0.232487 | 0.332648 | 1.456492 |
| granite-embedding-small-english-r2 | Warm load ms | 520.086 | 491.781 | 934.517 |
| granite-embedding-small-english-r2 | Single docs/s | 54.519 | 19.308 | 15.768 |
| granite-embedding-small-english-r2 | Batch docs/s | 71.504 | 25.554 | 21.254 |
| granite-embedding-small-english-r2 | RSS MiB | 371.19 | 375.07 | 308.86 |
| granite-embedding-small-english-r2 | Brute top-k ms | 0.330790 | 0.546901 | 0.602640 |
| granite-embedding-small-english-r2 | vec0 top-k ms | 0.124387 | 0.218631 | 0.510104 |
| potion-retrieval-32m-static-floor | Warm load ms | 57.329 | 124.105 | 161.328 |
| potion-retrieval-32m-static-floor | Single docs/s | 1907.957 | 634.670 | 609.723 |
| potion-retrieval-32m-static-floor | Batch docs/s | 2791.025 | 1378.172 | 1053.285 |
| potion-retrieval-32m-static-floor | RSS MiB | 177.73 | 182.32 | 144.43 |
| potion-retrieval-32m-static-floor | Brute top-k ms | 0.415047 | 0.671595 | 0.727488 |
| potion-retrieval-32m-static-floor | vec0 top-k ms | 0.176920 | 0.282462 | 0.673508 |

Every candidate was measured in its own child process on each platform. Linux x64 and Windows x64 are the canonical §5.1 environments; macOS arm64 is informative.

## Cosine Distributions and τ_dense Proposals

### Recorded Slice

| Candidate | Pair set | n | min | p05 | median | p95 | max |
|---|---|---:|---:|---:|---:|---:|---:|
| bge-small-en-v1.5 | gold | 90 | 0.362891 | 0.385200 | 0.497198 | 0.711488 | 0.720247 |
| bge-small-en-v1.5 | random | 49 | 0.353353 | 0.386511 | 0.487502 | 0.575933 | 0.761765 |
| gte-modernbert-base | gold | 90 | 0.198734 | 0.221201 | 0.359285 | 0.544281 | 0.574256 |
| gte-modernbert-base | random | 49 | 0.168122 | 0.220180 | 0.326961 | 0.450483 | 0.640881 |
| granite-embedding-small-english-r2 | gold | 90 | 0.632529 | 0.642144 | 0.735807 | 0.831990 | 0.834136 |
| granite-embedding-small-english-r2 | random | 49 | 0.624574 | 0.658616 | 0.705907 | 0.764398 | 0.793769 |
| potion-retrieval-32m-static-floor | gold | 90 | -0.032606 | -0.012736 | 0.071760 | 0.361039 | 0.535491 |
| potion-retrieval-32m-static-floor | random | 49 | -0.073041 | -0.041989 | 0.026665 | 0.239809 | 0.647689 |

### Authored Slice

| Candidate | Pair set | n | min | p05 | median | p95 | max |
|---|---|---:|---:|---:|---:|---:|---:|
| bge-small-en-v1.5 | gold | 32 | 0.419640 | 0.480699 | 0.557720 | 0.702985 | 0.741992 |
| bge-small-en-v1.5 | random | 32 | 0.385650 | 0.402273 | 0.455871 | 0.566193 | 0.620615 |
| gte-modernbert-base | gold | 32 | 0.209108 | 0.291627 | 0.400691 | 0.552122 | 0.593559 |
| gte-modernbert-base | random | 32 | -0.168755 | 0.009010 | 0.284471 | 0.449145 | 0.486716 |
| granite-embedding-small-english-r2 | gold | 32 | 0.676698 | 0.678025 | 0.748288 | 0.820604 | 0.830237 |
| granite-embedding-small-english-r2 | random | 32 | 0.644508 | 0.657116 | 0.697467 | 0.740481 | 0.745680 |
| potion-retrieval-32m-static-floor | gold | 32 | -0.040987 | -0.012321 | 0.130257 | 0.613565 | 0.702297 |
| potion-retrieval-32m-static-floor | random | 32 | -0.080669 | -0.063029 | 0.019381 | 0.193776 | 0.276237 |

### Recorded Gold-Pair Calibration

| Candidate profile | Recorded gold pairs | p05 | Proposed τ_dense (round down, 2 decimals) |
|---|---:|---:|---:|
| bge-small-en-v1.5 | 90 | 0.385200 | 0.38 |
| gte-modernbert-base | 90 | 0.221201 | 0.22 |
| granite-embedding-small-english-r2 | 90 | 0.642144 | 0.64 |
| potion-retrieval-32m-static-floor | 90 | -0.012736 | -0.02 |

The raw JSON retains every gold-pair and deterministic random-pair cosine for audit.

## Pre-declared Decision Rule

1. An alternate displaces bge-small only if it beats it on recorded-slice hit@5 by ≥ 3.0 absolute points AND its recorded-slice hit@1 is not lower; the report must note dim/cost consequences (gte 768-d = 2× vector storage, ~4.4× model bytes) — ties go to bge-small.
2. The floor is "acceptable beyond emergency mode" only if its recorded-slice hit@5 is within 10.0 absolute points of the winner's.
3. τ_dense per profile (locked default AND floor) = the 5th percentile of gold-pair cosine similarities on the recorded slice, rounded DOWN to 2 decimals — a permissive admission floor; the gold and random-pair distributions are recorded so the number is auditable.

## Mechanical Verdict

Status: **selected**

Selected default: **bge-small-en-v1.5**

No native alternate cleared both displacement margins; the default remains bge-small, including on ties.

gte-modernbert-base uses 768 dimensions: 2× bge-small vector storage and approximately 4.4× model bytes.

Floor candidate: **potion-retrieval-32m-static-floor**; acceptable beyond emergency mode: **true**; trailing recorded hit@5 gap: **8.33 points**.

## D-04 Language Mix Record

English-only validated; multilingual unbenched; granite-multilingual-r2 is the documented escape hatch, benched when a real non-English app arrives.

## Ratification

Pending human review in Plan 376-11.
