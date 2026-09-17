# ADR-009: Reciprocal Rank Fusion to combine lexical and dense results

Status: accepted (2026-09-16)

## Context

BM25 scores and cosine similarities live on incomparable scales, so summing or
averaging them directly is meaningless without model-specific calibration.

## Decision

`reciprocalRankFusion` combines the two ranked lists using only rank position:
`score = Σ 1 / (k + rank + 1)` with `k = 60` (a standard RRF constant), so a chunk that
appears near the top of either list scores highly regardless of its raw BM25 or cosine
value. Ties are broken by ascending chunk id for determinism.

## Alternatives considered

- Weighted-sum of normalized scores: requires picking and maintaining per-query or
  per-corpus normalization; RRF needs no tuning and is rank-only. Rejected for v0.
- Learned re-ranking (a cross-encoder pass): meaningfully better ranking quality, but
  adds a second model and real latency. Deferred to benchmarks.

## Consequences

Fusion is deterministic and has exactly one constant (`k`) to reason about; result
quality depends entirely on each channel's own ranking, not on cross-channel score
calibration.
