import type { MetaFunction } from '@remix-run/cloudflare';
import {
  PublicSiteFooter,
  PublicSiteHeader,
} from '~/components/site/public-shell';
import { SystemArchitectureDiagram } from '~/components/technical/system-architecture-diagram';

export const meta: MetaFunction = () => [
  { title: 'Technical Details - Paillette' },
  {
    name: 'description',
    content:
      'Paillette system architecture, retrieval flow, and performance evidence.',
  },
];

export const RETRIEVAL_CHANNELS = [
  { name: 'Keyword', detail: 'Plain-text match for exact terms.' },
  {
    name: 'Metadata',
    detail: 'Artist, title, date, medium, and accession fields.',
  },
  {
    name: 'Captions',
    detail: 'Semantic and factual context from descriptions.',
  },
  {
    name: 'Image embeddings',
    detail: 'Visual similarity in the configured vector space.',
  },
  {
    name: 'Colour',
    detail: 'Colour language and dominant-palette refinement.',
  },
] as const;

export const FUSED_RETRIEVAL_SOURCES = [
  'image_embedding',
  'generated_caption_embedding',
  'metadata',
] as const;

export const TECHNICAL_EVIDENCE = [
  {
    level: 'Measured',
    value: 'queryTime',
    title: 'Per-request API timing',
    description:
      'Measured with performance.now() and returned with each successful search. This is one observation, not a latency percentile.',
  },
  {
    level: 'Test-backed',
    value: '100 + 10',
    title: 'Atomic daily quota boundary',
    description:
      'In the fake D1 concurrency harness, 110 simultaneous requests produce exactly 100 successes and 10 HTTP 429 responses.',
  },
  {
    level: 'Structural',
    value: '2 × 1,024D',
    title: 'Vector workload per text search',
    description:
      'The documented hot path can issue two Vectorize queries using configured 1,024-dimensional embeddings, plus D1 lookup and usage writes.',
  },
  {
    level: 'Pending',
    value: 'p50 / p95 / p99',
    title: 'Production load distribution',
    description:
      'Sustained production percentiles and the QPS degradation threshold are not yet measured; the checked-in k6 profile defines the next measurement step.',
  },
] as const;

const bottlenecks = [
  {
    title: 'Embedding provider latency and rate limits',
    detail:
      'External provider response time and quotas can bound the text-search path before retrieval begins.',
  },
  {
    title: 'Workers AI latency',
    detail:
      'The alternate managed model path adds its own inference time, which still needs production distribution data.',
  },
  {
    title: 'D1 LIKE scans',
    detail:
      'Plain-text matching may become more expensive as searchable metadata and caption rows grow.',
  },
  {
    title: 'Corpus coverage',
    detail:
      'Retrieval quality is bounded by which works, metadata, captions, and images are present in the index.',
  },
  {
    title: 'Load and human evaluation',
    detail:
      'Sustained load testing and blinded human relevance evaluation remain incomplete, so no broader performance claim is made here.',
  },
] as const;

const sectionClassName = 'border-t border-white/[0.08] py-12 md:py-16';
const sectionHeadingClassName =
  'font-display text-3xl font-semibold tracking-normal text-white md:text-4xl';
const bodyClassName = 'text-base leading-8 text-white/68 md:text-lg';

export default function TechnicalPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0e] text-white">
      <PublicSiteHeader active="technical" />

      <main className="w-full px-5 py-14 sm:px-6 lg:px-10 lg:py-20 xl:px-14">
        <header className="max-w-3xl pb-14 md:pb-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-100/55">
            System notes
          </p>
          <h1 className="mt-5 font-display text-5xl font-semibold tracking-normal text-white sm:text-6xl md:text-7xl">
            Technical details
          </h1>
          <p className={`mt-6 ${bodyClassName}`}>
            How a query moves through Paillette, which retrieval channels take
            part, and what the current evidence does—and does not—establish.
          </p>
        </header>

        <section className={sectionClassName}>
          <div className="mb-8 max-w-3xl">
            <h2 className={sectionHeadingClassName}>System architecture</h2>
            <p className={`mt-4 ${bodyClassName}`}>
              The runtime path spans the public web Worker, API coordination,
              model providers, vector retrieval, metadata hydration, usage
              accounting, and image delivery.
            </p>
          </div>
          <SystemArchitectureDiagram />
        </section>

        <section className={sectionClassName}>
          <div className="max-w-3xl">
            <h2 className={sectionHeadingClassName}>Retrieval and fusion</h2>
            <p className={`mt-4 ${bodyClassName}`}>
              The five user-facing search modes below describe ways to form or
              refine a query; they are not five separate RRF input lists.
              Current fusion combines ranked candidates from three concrete
              sources using reciprocal rank fusion with{' '}
              <span className="font-mono text-cyan-100/80">RRF_K = 60</span>.
            </p>
            <p className="mt-4 text-sm leading-7 text-white/55">
              Keyword matching runs within metadata retrieval. Colour language
              and refinement affect routing rather than contributing a
              standalone RRF list.
            </p>
            <div className="mt-5" aria-label="Current fused retrieval sources">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-100/65">
                Current fused sources
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {FUSED_RETRIEVAL_SOURCES.map((source) => (
                  <li
                    key={source}
                    className="rounded border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-xs text-white/65"
                  >
                    {source}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <ol className="mt-9 divide-y divide-white/[0.08] border-y border-white/[0.08]">
            {RETRIEVAL_CHANNELS.map((channel, index) => (
              <li
                key={channel.name}
                className="grid gap-2 py-5 sm:grid-cols-[3rem_12rem_1fr] sm:items-baseline sm:gap-5"
              >
                <span className="font-mono text-xs tabular-nums text-white/30">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="text-base font-semibold text-white">
                  {channel.name}
                </h3>
                <p className="text-sm leading-7 text-white/55">
                  {channel.detail}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className={sectionClassName}>
          <div className="max-w-3xl">
            <h2 className={sectionHeadingClassName}>Performance evidence</h2>
            <p className={`mt-4 ${bodyClassName}`}>
              These labels separate runtime measurement, test evidence, workload
              structure, and work that remains unmeasured.
            </p>
          </div>

          <div className="mt-9 border-y border-white/[0.08]">
            {TECHNICAL_EVIDENCE.map((item) => (
              <article
                key={item.level}
                className="grid gap-4 border-b border-white/[0.08] py-7 last:border-b-0 md:grid-cols-[9rem_13rem_1fr] md:gap-7"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-100/65">
                  {item.level}
                </p>
                <p className="font-display text-2xl font-semibold text-white md:text-3xl">
                  {item.value}
                </p>
                <div>
                  <h3 className="text-base font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 max-w-3xl text-sm leading-7 text-white/55">
                    {item.description}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={sectionClassName}>
          <div className="max-w-3xl">
            <h2 className={sectionHeadingClassName}>Expected bottlenecks</h2>
            <p className={`mt-4 ${bodyClassName}`}>
              These are the main constraints suggested by the current design;
              they are not a ranked production diagnosis.
            </p>
          </div>

          <ul className="mt-9 grid border-y border-white/[0.08] md:grid-cols-2">
            {bottlenecks.map((item) => (
              <li
                key={item.title}
                className="border-b border-white/[0.08] py-6 md:odd:pr-8 md:even:border-l md:even:pl-8"
              >
                <h3 className="text-base font-semibold text-white">
                  {item.title}
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-white/55">
                  {item.detail}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <PublicSiteFooter separated />
      </main>
    </div>
  );
}
