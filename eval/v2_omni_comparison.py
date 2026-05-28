"""Compare the v2 routed approach against Jina v5 omni variants.

This is a focused follow-up to v2_bakeoff.py. It reuses the same v2 corpus
filter and scoring helpers, but writes separate artifacts so the original
bakeoff report remains stable.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from v2_bakeoff import (
    HERE,
    TOP_K,
    filter_to_v2,
    load_app_artworks,
    load_legacy_corpus,
    load_queries,
    metadata_search,
    prepare_app_db,
    result_file,
    rrf_fuse,
    routed_rrf_fuse,
    summarize_candidate,
    vector_coverage,
)


def render_markdown(output: dict[str, Any], path: Path) -> None:
    coverage = output["coverage"]
    metrics = output["metrics"]
    lines = [
        "# V2 Omni Comparison",
        "",
        f"Generated: {output['generated_at']}",
        "",
        "## Scope",
        "",
        "This compares the v2 decided routed RRF approach against Jina v5 omni variants using the same v2 corpus filter as `eval/v2_bakeoff.py`.",
        "It uses existing local result files, not fresh Vectorize hits, so it is an offline staging diagnostic.",
        "",
        "## Vector Coverage",
        "",
        "| vector set | total | in v2 | missing v2 |",
        "| --- | ---: | ---: | ---: |",
    ]
    for vector_name in ["jina", "caption", "caption_v5_text_small", "v5_omni_small"]:
        if f"{vector_name}_vectors" in coverage:
            lines.append(
                f"| {vector_name} | {coverage[f'{vector_name}_vectors']} | "
                f"{coverage[f'{vector_name}_vectors_in_v2']} | "
                f"{coverage[f'{vector_name}_vectors_missing_for_v2']} |"
            )

    lines.extend(
        [
            "",
            "## Candidates",
            "",
            "- `decided_bge_routed`: Jina CLIP v2 image + original BGE caption channel + metadata.",
            "- `decided_jina_text_routed`: Jina CLIP v2 image + Jina v5 text-small caption channel + metadata.",
            "- `omni_image_only`: Jina v5 omni-small image vectors only, no metadata/caption.",
            "- `omni_image_metadata`: Jina v5 omni-small image vectors + metadata routing.",
            "- `omni_family_routed`: Jina v5 omni-small image vectors + Jina v5 text-small caption vectors + metadata.",
            "",
            "## Metrics",
            "",
            "| candidate | avg results/query | source-backed top10 | no-title top10 | metadata exact @1/@5/@10 | medium exact @10 | text-overlap top10 | channel counts |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
        ]
    )
    for metric in metrics:
        lines.append(
            f"| {metric['name']} | {metric['avg_results_per_query']} | "
            f"{metric['source_backed_top10_rate']:.2%} | "
            f"{metric['no_title_top10_rate']:.2%} | "
            f"{metric['metadata_exact_top1']:.2%} / {metric['metadata_exact_top5']:.2%} / {metric['metadata_exact_top10']:.2%} | "
            f"{metric['medium_exact_top10']:.2%} | "
            f"{metric['avg_text_overlap_top10']:.2%} | "
            f"`{json.dumps(metric['top10_channel_counts'], sort_keys=True)}` |"
        )

    lines.extend(
        [
            "",
            "## Readout",
            "",
            output["readout"],
            "",
            "## Notes",
            "",
            "- `v5_omni_small` here means `jina-embeddings-v5-omni-small` image vectors queried by text with the same model.",
            "- `caption_v5_text_small` is used for the Jina caption channel because Jina documents the v5 omni space as aligned with v5 text-small; it is the cheaper text-only path for text inputs.",
            f"- Each result list is capped at top {TOP_K}.",
        ]
    )
    path.write_text("\n".join(lines) + "\n")


def rename_channel(
    candidate: dict[str, list[dict[str, Any]]],
    old: str,
    new: str,
) -> dict[str, list[dict[str, Any]]]:
    output = {}
    for query_id, hits in candidate.items():
        output[query_id] = [
            {
                **hit,
                "channels": [
                    new if channel == old else channel
                    for channel in hit.get("channels", [])
                ],
            }
            for hit in hits
        ]
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-db", type=Path, default=Path("/tmp/paillette-stg-ngs.sqlite"))
    parser.add_argument("--etl-sql", type=Path, default=Path("/tmp/paillette-ngs-app-etl.sql"))
    parser.add_argument("--app-db", type=Path, default=Path("/tmp/paillette-v2-bakeoff.sqlite"))
    parser.add_argument("--out-json", type=Path, default=HERE / "v2-omni-comparison.json")
    parser.add_argument("--out-report", type=Path, default=HERE / "v2-omni-comparison.md")
    parser.add_argument("--rebuild-etl", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    app_db = prepare_app_db(args)
    app_rows = load_app_artworks(app_db)
    legacy_rows = load_legacy_corpus()
    queries = load_queries()

    jina_image = filter_to_v2(result_file("jina"), app_rows, legacy_rows, require_image=True)
    bge_caption = filter_to_v2(result_file("caption"), app_rows, legacy_rows, require_caption=True)
    jina_caption = filter_to_v2(
        result_file("caption_v5_text_small"),
        app_rows,
        legacy_rows,
        require_caption=True,
    )
    omni_image = filter_to_v2(
        result_file("v5_omni_small"),
        app_rows,
        legacy_rows,
        require_image=True,
    )
    metadata = metadata_search(queries, app_rows, enriched=True)

    candidates = {
        "decided_bge_routed": routed_rrf_fuse(
            queries,
            app_rows,
            legacy_rows,
            jina_image,
            bge_caption,
            metadata,
        ),
        "decided_jina_text_routed": routed_rrf_fuse(
            queries,
            app_rows,
            legacy_rows,
            jina_image,
            jina_caption,
            metadata,
        ),
        "omni_image_only": omni_image,
        "omni_image_metadata": rrf_fuse(
            [
                ("omni_image", 1.0, omni_image),
                ("metadata", 1.0, metadata),
            ],
            app_rows,
            legacy_rows,
        ),
        "omni_family_routed": routed_rrf_fuse(
            queries,
            app_rows,
            legacy_rows,
            omni_image,
            jina_caption,
            metadata,
        ),
    }
    candidates["omni_family_routed"] = rename_channel(
        candidates["omni_family_routed"],
        "jina_image",
        "omni_image",
    )

    metrics = [
        summarize_candidate(name, candidate, queries, app_rows, legacy_rows)
        for name, candidate in candidates.items()
    ]
    metric_by_name = {metric["name"]: metric for metric in metrics}
    decided = metric_by_name["decided_jina_text_routed"]
    omni = metric_by_name["omni_family_routed"]
    readout = (
        "`omni_family_routed` is the clean Jina-v5-family alternative, but this "
        "offline diagnostic should not replace judged relevance. Compare exact "
        f"metadata @10 {omni['metadata_exact_top10']:.2%} vs "
        f"{decided['metadata_exact_top10']:.2%}, medium @10 "
        f"{omni['medium_exact_top10']:.2%} vs {decided['medium_exact_top10']:.2%}, "
        f"and text overlap {omni['avg_text_overlap_top10']:.2%} vs "
        f"{decided['avg_text_overlap_top10']:.2%}. A final call still needs a "
        "small judged montage or live Vectorize smoke test because these metrics "
        "do not measure visual relevance directly."
    )
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "app_db": str(app_db),
        "coverage": vector_coverage(app_rows),
        "metrics": metrics,
        "readout": readout,
    }
    args.out_json.write_text(json.dumps(output, indent=2) + "\n")
    render_markdown(output, args.out_report)
    print(f"-> {args.out_json}")
    print(f"-> {args.out_report}")


if __name__ == "__main__":
    main()
