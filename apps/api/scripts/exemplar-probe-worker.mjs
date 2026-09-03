/**
 * A verification worker, and **not** the product.
 *
 * `POST /search/exemplars` in `src/routes/search.ts` is the real thing and the
 * only implementation that ships. This file mirrors its arithmetic so the same
 * formula can be pointed at the real staging vector index from a laptop, which
 * the route itself cannot be: it needs a D1 binding local dev does not carry,
 * and remote dev refuses to open a preview session on the API's custom domain.
 *
 * It answers the one question the unit tests cannot. Those use hand-built
 * two-dimensional vectors, so they prove the arithmetic is the arithmetic —
 * they cannot show that `getByIds` resolves a real NGA artwork id to a real
 * embedding, or that the centroid of three shipwrecks lands anywhere sensible
 * among 63,253 works.
 *
 * If the route's scoring changes this drifts and stops meaning anything. It is
 * a measuring instrument, not a second implementation to maintain: read the
 * route first, and treat any disagreement as this file being out of date.
 *
 *   cd apps/api/scripts
 *   ../node_modules/.bin/wrangler dev -c exemplar-probe.wrangler.toml \
 *     --experimental-vectorize-bind-to-prod --port 8790
 *   node verify-exemplars-live.mjs
 */

const ORG = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

const meanVector = (vectors) => {
  const first = vectors[0];
  if (!first?.length) return null;
  const dims = first.length;
  const total = new Float64Array(dims);
  let counted = 0;
  for (const v of vectors) {
    if (!v || v.length !== dims) continue;
    for (let i = 0; i < dims; i += 1) total[i] += v[i];
    counted += 1;
  }
  if (!counted) return null;
  let norm = 0;
  for (let i = 0; i < dims; i += 1) {
    total[i] /= counted;
    norm += total[i] * total[i];
  }
  norm = Math.sqrt(norm);
  if (!(norm > 0)) return null;
  return Array.from(total, (x) => x / norm);
};

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? dot / d : null;
};

const byIds = async (index, ids) => {
  const out = [];
  for (let i = 0; i < ids.length; i += 20) {
    out.push(...(await index.getByIds(ids.slice(i, i + 20))));
  }
  return out;
};

export default {
  async fetch(request, env) {
    const body = await request.json();
    const positiveIds = body.positiveIds ?? [];
    const negativeIds = body.negativeIds ?? [];
    const topK = body.topK ?? 8;
    const w = body.negativeWeight ?? 0.5;
    // The route uses max and only max. `mean` exists here so the design claim
    // — that averaging lets a cluster of mild rejects cancel a strong one —
    // can be measured against real vectors rather than asserted.
    const aggregate = body.negativeAggregate === 'mean' ? 'mean' : 'max';

    const index = env.VECTORIZE_V2;
    const positives = await byIds(index, positiveIds);
    const negatives = negativeIds.length ? await byIds(index, negativeIds) : [];

    const centroid = meanVector(positives.map((v) => v.values));
    if (!centroid) {
      return Response.json({
        error: 'EXEMPLARS_NOT_INDEXED',
        askedFor: positiveIds.length,
        gotVectors: positives.length,
      });
    }

    const blocked = new Set([...positiveIds, ...negativeIds]);
    const q = await index.query(centroid, {
      topK: Math.min(Math.max(topK * 6, 20), 100),
      filter: { galleryId: ORG, provider: 'nga' },
      returnValues: false,
      returnMetadata: 'indexed',
    });
    if (body.dumpMetadata) {
      return Response.json({ sample: q.matches.slice(0, 3) });
    }
    const candidates = q.matches
      .map((m) => ({ id: m.id, positiveScore: m.score, metadata: m.metadata }))
      .filter((c) => !blocked.has(c.id));

    let scored;
    if (!negatives.length || !candidates.length) {
      scored = candidates.map((c) => ({ id: c.id, score: c.positiveScore, penalty: 0, metadata: c.metadata }));
    } else {
      const vectors = await byIds(index, candidates.map((c) => c.id));
      const valuesById = new Map(vectors.map((v) => [v.id, v.values]));
      scored = candidates.map((c) => {
        const values = valuesById.get(c.id);
        if (!values) return { id: c.id, score: c.positiveScore, penalty: null, metadata: c.metadata };
        const sims = negatives
          .map((n) => cosine(values, n.values))
          .filter((s) => s !== null);
        let aggregated = -1;
        if (sims.length) {
          aggregated =
            aggregate === 'mean'
              ? sims.reduce((a, b) => a + b, 0) / sims.length
              : Math.max(...sims);
        }
        const penalty = aggregated > -1 ? w * aggregated : 0;
        return { id: c.id, score: c.positiveScore - penalty, penalty, metadata: c.metadata };
      });
    }
    scored.sort((a, b) => b.score - a.score);

    return Response.json({
      positivesAsked: positiveIds.length,
      positiveVectorsFound: positives.length,
      negativeVectorsFound: negatives.length,
      dimensions: positives[0]?.values?.length ?? null,
      negativeAggregate: aggregate,
      candidatePool: q.matches.length,
      results: scored.slice(0, topK),
    });
  },
};
