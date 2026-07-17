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

export const PERFORMANCE_METRICS = [
  { label: 'p50', value: '—' },
  { label: 'p95', value: '—' },
  { label: 'p99', value: '—' },
  { label: 'Max tested throughput', value: '—' },
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
            How Paillette turns a search into ranked artworks.
          </p>
        </header>

        <section className={sectionClassName}>
          <div className="mb-8 max-w-3xl">
            <h2 className={sectionHeadingClassName}>System architecture</h2>
            <p className={`mt-4 ${bodyClassName}`}>
              From browser request to ranked result.
            </p>
          </div>
          <SystemArchitectureDiagram />
        </section>

        <section className={sectionClassName}>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className={sectionHeadingClassName}>Performance</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
              Staging run required
            </p>
          </div>

          <dl className="mt-8 grid grid-cols-2 border-y border-white/[0.08] lg:grid-cols-4">
            {PERFORMANCE_METRICS.map((item) => (
              <div
                key={item.label}
                className="border-b border-white/[0.08] py-7 even:border-l even:pl-5 lg:border-b-0 lg:border-l lg:px-7 lg:first:border-l-0 lg:first:pl-0"
              >
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                  {item.label}
                </dt>
                <dd className="mt-3 font-display text-4xl font-semibold tabular-nums text-white">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <PublicSiteFooter separated />
      </main>
    </div>
  );
}
