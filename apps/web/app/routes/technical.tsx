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
    content: 'Paillette system architecture and retrieval flow.',
  },
];

const sectionHeadingClassName =
  'font-display text-3xl font-semibold tracking-normal text-white md:text-4xl';
const bodyClassName =
  'text-base leading-8 text-white/68 md:text-lg md:leading-9';
export const TECHNICAL_MAIN_CLASS_NAME =
  'mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-20';
export const TECHNICAL_BODY_GROUP_CLASS_NAME = 'mt-5 max-w-6xl space-y-5';

export default function TechnicalPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0e] text-white">
      <PublicSiteHeader active="technical" />

      <main className={TECHNICAL_MAIN_CLASS_NAME}>
        <h1 className="font-display text-6xl font-semibold tracking-normal text-white md:text-7xl">
          Technical details
        </h1>

        <section className="mt-12 py-4 md:mt-16">
          <h2 className={sectionHeadingClassName}>System architecture</h2>
          <div className={TECHNICAL_BODY_GROUP_CLASS_NAME}>
            <p className={bodyClassName}>
              From browser request to ranked result.
            </p>
          </div>
          <div className="mt-8">
            <SystemArchitectureDiagram />
          </div>
        </section>

        <PublicSiteFooter separated />
      </main>
    </div>
  );
}
