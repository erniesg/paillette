# Codex handoff — rate the embedding eval

Paste this whole file into Codex, running in the `paillette` repo.

---

You are a relevance judge for an art-search embedding evaluation. Your job is to
score retrieval quality by looking at images, and write a JSON file.

**Inputs** — in `eval/montages/` there are 56 PNG montages, one per search query
(filenames are the query ids: `kw-01.png`, `oc-03.png`, `mo-05.png`, `md-02.png`,
`st-04.png`, `me-06.png`, `met-02.png`, `co-07.png`, …).

Each montage shows, top to bottom:
- the **search query** text and its **intent type**
- one row per approach present in `eval/results/`. The current expected rows are:
  `jina`, `openclip`, `caption`, `v5_omni_small`, and optionally
  `caption_v5_text_small` when the new Jina result files have been generated.
  Each row is that approach's top-8 retrieved artworks for the query.

**Task** — open and look at every montage. For each one, rate how well **each
approach row present in the montage** answered the query, on a **0–3** scale:
- **3** — excellent: the results strongly match the query intent
- **2** — relevant: mostly on-target
- **1** — loose: weakly related
- **0** — irrelevant

**What "match" means depends on the intent type:**
- `keyword` — is the named object/subject literally depicted?
- `occasion` — would a curator plausibly feature this for that festival/event?
- `motif` — does the visual pattern/structure appear, regardless of subject?
- `mood` — does the artwork evoke that feeling?
- `style` — does it exhibit that art style / movement / technique?
- `medium` — is it made in that medium / material?
- `metadata` — does it match that artist / title / accession / classification / date?
- `color` — is that colour prominent in the artwork?

Judge each approach's row holistically (the quality of its 8 results as a set).
Be consistent and critical — do not inflate scores.

**Output** — write `eval/judgements/codex.json` exactly in this shape:

```json
{
  "jina":           {"kw-01": 2, "kw-02": 3, "...": "every query id"},
  "openclip":       {"kw-01": 2, "...": "..."},
  "caption":        {"kw-01": 3, "...": "..."},
  "v5_omni_small":  {"kw-01": 3, "...": "..."},
  "caption_v5_text_small": {"kw-01": 2, "...": "..."}
}
```

Only include approaches that actually appear as rows in the montages. One
integer 0–3 per (approach, query). All 56 query ids, all present approaches.
Do not skip any. When done, report the per-approach average and any queries you
found hardest to call.
