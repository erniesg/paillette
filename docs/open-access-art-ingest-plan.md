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
- Apply the smallest ArtIC+NGA pilot with `pnpm open:apply -- --manifest=tmp/open-access-art-apply-smoke/manifest.json --out-dir=tmp/open-access-art-pilot-2-stg --limit=2 --external-providers=artic --upload --apply-d1 --embed-images --upsert-vectors`.
- ArtIC IIIF URLs are officially hotlinkable, but direct server-side fetches from this environment received a Cloudflare challenge during the pilot. Keep ArtIC as `--external-providers=artic` until there is a fetch path that respects their throttling guidance and avoids challenge pages.
- NGA image rows can be cached into R2 and embedded with Jina CLIP through the current apply path.
