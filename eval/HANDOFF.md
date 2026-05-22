# Handoff — Paillette: NGS embedding eval + product integration

You're picking up work on **Paillette** (`/Users/erniesg/code/erniesg/paillette`),
a Cloudflare-stack art-search app. The previous session ran an embedding-approach
evaluation — it's **landed at "good enough"**. There are **two threads to hand off**.

## Status — eval fully landed

The eval is **done and dual-judged**: **Claude and Codex both rated all 56
queries** — they agree **74% exactly, 100% within 1 point**, so the finding is
reliable, not a single-judge artifact. `eval/review.html` is the dual-judge
artifact. **Decision: hybrid — jina-clip-v2 (image) + caption→embed** (see
`eval/FINDINGS.md`).

**Your job is Part 2 — the product integration.** It has not been started. The
embedding decision is already made; you *implement* it, you don't re-run the eval.

---

## Part 1 — the eval (LANDED)

Self-contained in `eval/`. Full result: **`eval/FINDINGS.md`**. Visual artifact:
open **`eval/review.html`**.

TL;DR: image-CLIP and caption→embed are **complementary** — image-CLIP wins
*visual* queries (motif, medium, colour), caption→embed wins *factual* queries
(artist, date) → **use a hybrid**; jina-clip-v2 for the image side.

State on disk:
- `corpus.jsonl` (8,023 imaged artworks) · `corpus_grounding.jsonl` (raw NGS/roots)
- `images/` thumbnails · `vectors/{jina,openclip,caption}.npz` (8,023 each)
- `results/*.json` retrieval · `montages/*.png` (56) · `judgements/{claude,codex}.json`
- harness: `embed.py · caption.py · caption_embed.py · run_eval.py · montage.py · build_review.py`
- venvs: `.venv` (embedding/eval) · `.venv-cap` (mlx-vlm captioning)
- `query_split.json` marks 16 held-out test queries (don't tune against them)

Further extensions (optional, beyond Handoff A): benchmark a real **hybrid** row;
the hardening designed in-session but not built — paraphrase-robustness,
repeated-measurement (judge self-consistency), and a re-runnable regression suite.

---

## Part 2 — the product integration (NOT STARTED — the real work)

Goal: get the NGS dataset live in Paillette's search.

**Data layout — two D1 databases, one shared R2 bucket:**
- `paillette-stg` (D1, id `6dbc150f-…`) — the NGS dataset. Schema:
  `institutions / collections / artworks / assets`. 10,295 artworks, 8,023 imaged.
- `paillette-db-stg` — the **app's** D1. Schema `users / galleries / collections /
  artworks` (migrations `packages/database/migrations/0001-0005`). **No `assets` table.**
- R2 `paillette-assets-stg` is **shared** — NGS blobs are already in the app's
  staging bucket. Integration is **metadata ETL only** — no blob movement.

**Roadmap (from the session's architecture analysis):**
1. **Schema migration (0006+)** on the app D1: rename `galleries`→`orgs` (the
   user explicitly wants "orgs" — ripples through every `gallery_id`, the
   `/galleries/*` API routes, the web routes); add an `assets` table
   (`role` = original|thumb|web|…); add `field_sources` JSON for NGS provenance
   (⚠ the app's existing `provenance` column means *ownership history* — don't
   collide, use a new name); make image columns nullable (2,268 NGS artworks
   have no image).
2. **ETL** `paillette-stg` → `paillette-db-stg`: institution→org, assets→assets,
   resolved metadata→columns, sourcing→`field_sources`. NGS becomes org #1.
3. **Fix the broken search.** Today text search embeds with BGE (768-d) and image
   search with Jina (1024-d) — different spaces, the index validates 1024 — so
   text→image cross-modal search **does not actually work**. Use one multimodal
   model's *both* encoders. Per the eval: **jina-clip-v2**, embedded **locally**
   (it is NOT on Workers AI), upserted to Vectorize; add **caption→embed** as a
   second channel and **fuse** (hybrid) — see `FINDINGS.md`.
   - **Fusion = plain equal-weight RRF — no query classifier.** RRF self-routes:
     the channel with genuinely strong matches wins per-query, so query "type" is
     never an input. Add cheap *exact-signal* boosts (query == a known artist
     name; query is a hex code) only if dev queries show RRF falling short —
     deterministic lookups, not a learned classifier. **Do not build a classifier.**
   - Support **reverse-image search** (drag-drop): the image channel does it
     natively — embed the dropped image with jina-clip-v2, ANN-search the image
     index. The app already has a `/search/image` endpoint.
   - Optionally expose the channel weights as a light **UI override**.
4. **Normalize for facets:** parse `date_text`→`year_start`/`year_end`; add a
   `culture`/`origin` field; controlled medium vocab — enables the time-based
   view and cross-cultural compare.
5. **Features:** per-field **source attribution** in the artwork detail view;
   **group-by-facet** results (the cross-cultural "how cultures draw tigers"
   compare); a **timeline** scrubber; eventually a time×culture matrix.

**Constraints:** `rights` / `credit_line` gate public display — respect them
before anything goes public; `medium` + `rights` come 100% from the NGS 2022
catalogue export. Embedding stays **local** + a delta script (the model is the
coordinate system — embed *new* artworks into the existing space; only re-embed
everything on a model change). `wrangler` is authenticated on this machine.

**Begin with Part 2, step 1 — the schema migration.**
