# Citeline — Design Spec

**Date:** 2026-09-19
**Status:** Approved

## Problem

Engineering teams publish large documentation sites, and their users cannot find
answers in them. Site search matches keywords, not questions. Generic LLM chat
invents APIs that never existed. Documentation teams have no signal about which
questions their docs fail to answer.

## Product

Citeline is a self-serve answer engine for technical documentation. A user signs
in with GitHub, points a project at a documentation source, and gets a hosted
question-answering interface plus an embeddable widget for their own docs site.

### Sources

- Website sitemap URL (crawl, bounded)
- GitHub repository markdown files
- OpenAPI specification (JSON or YAML)

### Core behaviours

1. **Ingestion is incremental and resumable.** Pages are content-hashed; a
   re-crawl skips unchanged pages. A crawl that hits a rate limit or a flaky
   page resumes rather than restarting.
2. **Answers are cited.** Every claim carries a citation marker resolving to a
   source page and heading anchor. Markers are validated against the chunks
   actually supplied to the model; invented references are stripped before
   display.
3. **Refusal is a feature.** When retrieval confidence falls below threshold,
   Citeline says it does not know, suggests the nearest pages, and records the
   question as a content gap.
4. **Content-gap reporting.** Analytics surface top questions, thumbs
   up/down feedback, and the unanswered-question list — the primary value for
   documentation maintainers.
5. **Embeddable widget.** A single script tag renders a launcher on the
   customer's docs site, authenticated by public project key with a domain
   allowlist.
6. **Public demo mode.** Pre-indexed showcase projects let a visitor try the
   product without signing up.

### Non-goals (v1)

Billing, teams and seats, Slack/Notion connectors, model fine-tuning,
internationalisation.

## Architecture

Single Next.js App Router application deployed to Vercel. Neon Postgres with
pgvector stores documents and embeddings. Gemini supplies embeddings and
generation behind a provider interface, so switching providers is a
configuration change. Upstash Redis handles rate limiting and query caching.
Inngest runs ingestion as durable, throttled, retryable steps.

### Platform constraints that shaped this design

- Vercel Hobby caps function duration (~60s) and cron frequency (~daily).
  Ingestion therefore cannot run inside a request and cannot rely on cron.
- Gemini free tier enforces per-minute and per-day request limits. Ingestion
  concurrency and throttling are configured to stay inside them.
- Neon free tier: 0.5 GB, auto-suspend when idle.
- The database region (AWS ap-southeast-1) and the Vercel function region must
  match to avoid cross-region latency on every query.

### Module boundaries

Core logic is framework-free and testable against fixtures. No module below
imports from Next.js.

| Module | Responsibility |
| :--- | :--- |
| `src/lib/ingest` | Source fetchers, HTML/markdown normalisation, heading-aware chunking, content hashing |
| `src/lib/embed` | Provider-agnostic batched embedding with retry |
| `src/lib/retrieval` | Vector search, full-text search, rank fusion, context assembly under token budget |
| `src/lib/answer` | Prompt construction, streaming, citation extraction and validation, refusal rule |
| `src/lib/evals` | Dataset loading, retrieval metrics, LLM-judge, report generation |

## Data model

Auth.js owns `user`, `account`, `session`, `verificationToken`.

| Table | Purpose |
| :--- | :--- |
| `project` | Tenant root; owned by a user; holds public widget config |
| `source` | One ingestion source belonging to a project |
| `document` | A page: URL, title, content hash, crawl status |
| `chunk` | Text chunk with heading path, token count, `vector(768)` embedding, generated `tsvector` |
| `conversation`, `message` | Chat history; citations stored as JSONB |
| `feedback` | Thumbs up/down per message |
| `query_log` | Question, retrieved chunk ids, latency, confidence, answered flag — powers analytics and content gaps |
| `widget_key` | Public key plus allowed domains |
| `ingest_run` | Per-crawl status, counters, errors |

Indexes: HNSW on `chunk.embedding` (cosine), GIN on `chunk.tsv`, unique
`(document_id, chunk_index)`, index on `document(project_id, content_hash)`.

Multi-tenancy: every retrieval query is scoped by `project_id`, and project
ownership is verified server-side in each route handler. Client-supplied
project ids are never trusted.

## Retrieval pipeline

1. **Chunking.** Normalised markdown is split at heading boundaries into
   500–800 token chunks with overlap. Code blocks and tables are never split.
   Each chunk stores its breadcrumb heading path (e.g. `Guides › Auth › Refresh
   tokens`), which improves embedding quality and gives citations a readable
   label.
2. **Query rewriting.** Follow-up questions are rewritten into standalone
   queries using conversation history, via a cheap Flash call. Without this,
   multi-turn retrieval degrades immediately.
3. **Hybrid search.** Vector similarity over pgvector and Postgres full-text
   search run in parallel, each returning top-20. Results are combined with
   Reciprocal Rank Fusion (`score = Σ 1/(60 + rank)`).

   Rationale specific to documentation: embeddings blur exact symbols. A query
   for `useLayoutEffect` or `--no-verify` needs lexical matching, while
   conceptual queries need vectors. Hybrid retrieval serves both, and the
   eval harness must demonstrate this with measured numbers.
4. **Relevance filter.** Fused top results are scored and weak ones dropped.
   This doubles as the confidence signal for refusal.
5. **Context assembly.** Deduplicate near-identical chunks, merge adjacent
   chunks from the same document, cap at token budget, order by fused score.

## Answer generation

The system prompt requires citation markers on every claim and restricts the
model to supplied context. After generation, markers are parsed and validated
against the supplied chunk set; unresolvable markers are stripped.

Refusal triggers when the relevance filter retains zero chunks or the best
fused score is below threshold. Refusals are logged to the content-gap report.

## Evaluation harness

The differentiating artifact of this project.

- **Dataset.** For two or three showcase documentation sites, candidate
  question/answer pairs are generated from indexed chunks, then human-reviewed
  down to 60–100 items committed to the repository as JSON. The set includes
  deliberately unanswerable questions to measure refusal.
- **Retrieval metrics.** Recall@5, Recall@10, MRR, nDCG@10 against known-correct
  chunk ids. Deterministic, no model calls, cheap enough to gate CI.
- **Answer metrics.** Groundedness and relevance via LLM judge with a fixed
  rubric; precision and recall on "should have refused".
- **Ablation table.** README reports vector-only vs full-text-only vs hybrid
  fusion with measured numbers.
- **CI gate.** `npm run eval` runs in GitHub Actions; a pull request that
  degrades retrieval metrics below threshold fails the build.

## Reliability

- A page that fails to fetch is recorded and surfaced in the UI; it does not
  abort the crawl.
- Inngest retries with backoff; HTTP 429 feeds the throttle.
- Crawls respect `robots.txt` and are bounded by max pages, max depth, and
  same-origin rules — both ethical and a guard against exhausting free quotas.
- All external input is schema-validated with Zod.
- The widget endpoint checks `Origin` against the allowlist and rate-limits by
  key.
- If Redis is unavailable the application degrades (fail-open on caching,
  fail-closed on public widget endpoints) rather than erroring.

## Testing

- Vitest unit tests on the modules where bugs stay silent: normaliser, chunker,
  rank fusion, citation validator.
- Integration test for retrieval against a small seeded fixture corpus.
- One Playwright smoke test through the ask flow.
- Eval suite as a separate quality gate.

## Deployment

Vercel with preview deployments; functions pinned to the Neon region. GitHub
Actions runs lint, typecheck, unit tests, and the eval gate. `.env.example`
documents every variable. Separate GitHub OAuth applications for local and
production callbacks.
