# Open Access Art Ingest Plan

## Pilot Source Set

Start with **Art Institute of Chicago** and **National Gallery of Art, Washington**:

- Use `artic` and `nga` as provider keys.
- Keep `ngs` reserved for National Gallery Singapore. Do not use `ngs` for NGA Washington.
- `pnpm open:dry-run` defaults to this pilot source set.
- Use `pnpm open:dry-run -- --providers=full-v1` when Met and Cleveland should be included.

Rationale:

- ArtIC has clean API filters and useful metadata, but many records lack curatorial descriptions.
- NGA has high descriptive-text coverage through `published_images.assistivetext`.
- Met is valuable but too large for the first timing/caption-generation pass because most records do not expose institution caption text in the public API.
- Cleveland is clean, but smaller and less urgent than proving the ArtIC/NGA flow.

## Caption Policy

Treat source text and generated captions separately:

- Institution captions/descriptions remain catalogue text.
- NGA `assistivetext` is usable image-descriptive text, but label it as assistive/image description, not a curatorial essay.
- Generated captions go into `custom_metadata.generated_caption` with model, prompt version, generated time, and source image URL.
- Do not overwrite institution-provided descriptions with generated text.

Initial caption-generation target:

- Generate captions only for pilot records missing usable institution text.
- Benchmark on a 200-500 image sample before running any bulk generation.
- Record latency, GPU/CPU device, image size, tokens, failure rate, and a small human quality score.
- Use `pnpm open:dry-run -- --sample-caption=missing` to build benchmark manifests that contain only rows missing institution text in their normalized samples.

## Caption Model Shortlist

Benchmark these before choosing a bulk caption model:

- **Qwen2.5-VL 7B or 3B Instruct**: likely best first local quality candidate for artwork descriptions and OCR-like visible detail. Source: https://qwenlm.github.io/blog/qwen2.5-vl/
- **Gemma 3 / Gemma 3n**: worth testing because the newer Gemma line supports image+text tasks and 3n is optimized for everyday devices. Sources: https://ai.google.dev/gemma/docs/core and https://ai.google.dev/gemma/docs/gemma-3n
- **SmolVLM2 2.2B Instruct**: good speed baseline for local captioning. Source: https://huggingface.co/docs/transformers/model_doc/smolvlm
- **Florence-2 large**: compact captioning/detection/OCR baseline; useful for speed and deterministic captions, not necessarily best prose. Source: https://huggingface.co/microsoft/Florence-2-large

Default recommendation for the first benchmark:

1. Qwen2.5-VL-7B-Instruct for quality.
2. SmolVLM2-2.2B-Instruct for speed.
3. Gemma 3n only if local runtime support is straightforward on the available hardware.
4. Florence-2-large as a fast baseline.

## Cost / Timing Notes

- Local captioning has no per-call API cost, but can be slow enough that throughput matters more than Cloudflare storage cost.
- Keep image inputs small for benchmarking: start at 512px long edge, then compare 768px only if quality is weak.
- For API-based Jina CLIP image embeddings, token volume scales by image tiling; local embeddings avoid that API bill.
- Cloudflare costs are low for the pilot; the practical risk is time spent generating captions and vectors.

## Staging Apply Notes

- Seed the staging org and collection with `pnpm open:apply -- --seed-only --apply-d1`.
- Build a bounded pilot manifest with `pnpm open:dry-run -- --sample-size=1 --out=tmp/open-access-art-apply-smoke/manifest.json`.
- Download first, then upload/apply the same local files with `pnpm open:apply -- --manifest=tmp/open-access-art-apply-smoke/manifest.json --out-dir=tmp/open-access-art-pilot-2-stg --limit=2 --external-providers=artic --download --upload --apply-d1`.
- Use `--download-only` when preparing local embedding batches; it writes `asset-manifest.json` with local file paths, R2 object keys, content types, sizes, and SHA-256 checksums.
- ArtIC IIIF URLs are officially hotlinkable, but direct server-side fetches from this environment received a Cloudflare challenge during the pilot. Keep ArtIC as `--external-providers=artic` until there is a fetch path that respects their throttling guidance and avoids challenge pages.
- NGA image rows can be downloaded locally, cached into R2, and then embedded from the local `asset-manifest.json` in a separate local embedding step.
- A one-image missing-caption benchmark on NGA row `open-access-art:nga:41526` with `mlx-community/Qwen3-VL-30B-A3B-Instruct-4bit` completed in 8.4 seconds/image on this machine. Treat this as a smoke benchmark only; run a 200-500 image sample before bulk captioning.

## Delta Strategy

The ingest is designed to be rerunnable:

- Artwork IDs are stable: `open-access-art:<provider>:<providerRecordId>`.
- Asset IDs are stable by artwork ID, role, and asset version.
- R2 object keys are stable by collection, provider, provider record ID, and role.
- D1 writes use upserts, so rerunning the same manifest updates rows without duplicating artworks, assets, or collection membership.

For later deltas:

1. Run `pnpm open:dry-run` again for the same provider set.
2. Compare the new manifest/apply plan against the last applied manifest or D1 `source_record_id`/`custom_metadata.openAccessArt` state.
3. Treat new IDs as inserts, changed source metadata as updates, and changed `sourceImageUrl`/`sourceThumbnailUrl` as asset refreshes.
4. Run `pnpm open:apply -- --download --upload --apply-d1` for the delta manifest; add `--refresh-assets` for rows whose provider image bytes may have changed under the same stable URL.
5. Do not delete provider-missing records automatically until a source-specific deaccession policy is explicit. Mark removals separately, then decide whether to set `deleted_at`.

## Resumable Asset Ledger

Use the SQLite asset ledger before scaling beyond small pilots:

- Seed or refresh the ledger with `pnpm open:assets -- --manifest=tmp/open-access-art-pilot-50-local-first/manifest.json --db=tmp/open-access-art-pilot-50-local-first/apply/assets.sqlite --out-dir=tmp/open-access-art-pilot-50-local-first/apply --external-providers=artic --init --status`.
- Resume downloads with `pnpm open:assets -- --db=tmp/open-access-art-pilot-50-local-first/apply/assets.sqlite --download --providers=nga --concurrency=8 --status`.
- The ledger tracks one row per asset role with `pending`, `downloading`, `downloaded`, or `failed` status, attempts, errors, local path, R2 object key, content type, size, checksum, and timestamps.
- Existing local files are hashed and marked downloaded without re-fetching; use `--refresh-assets` to force a re-download.
- Run provider-specific workers separately when scaling so provider rate limits and failures do not block unrelated sources.
