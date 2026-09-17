# ADR-005: Snowflake Arctic Embed XS as the embedding model

Status: accepted (2026-09-16)

## Context

Local-first retrieval (ADR-002) needs an embedding model small enough to load and run
on a developer laptop with no GPU, without shipping code to a hosted API.

## Decision

Embeddings use `Snowflake/snowflake-arctic-embed-xs` via `@huggingface/transformers`,
loaded as a quantized (`dtype: 'q8'`) ONNX pipeline, CLS-pooled and L2-normalized to
384 dimensions. Queries are prefixed with `Represent this sentence for searching
relevant passages: `; documents are not. This is a fixed choice for v0, not a
pluggable provider list — the metaprompt named this model explicitly.

## Alternatives considered

- A larger Arctic Embed variant (S/M/L): better quality, slower cold start and more
  disk/RAM, unnecessary for repository-sized corpora. Deferred to benchmarks.
- OpenAI/Voyage hosted embedding APIs: no local install, but violates ADR-002 and
  sends source code off-machine. Rejected.

## Consequences

First index run downloads and caches the model (`doctor`'s "Embedding model" check
reports this); `HashEmbeddingProvider` exists only as a fast, deterministic test
double and is never used outside tests (`YANDECODE_EMBEDDINGS=hash`, test-only).
