import type { MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { useEffect, useId, useRef, useState } from 'react';
import { Logo } from '~/components/ui/logo';

export const meta: MetaFunction = () => {
  return [
    { title: 'About - Paillette' },
    {
      name: 'description',
      content:
        'Why Paillette was built and how its routed hybrid search works.',
    },
  ];
};

const searchFlowDiagram = `flowchart LR
  Q["User query"] --> R["<b>Routing</b><br/>choose<br/>search channels"]

  R --> K["<b>Keyword</b><br/>plain text<br/>match"]
  R --> M["<b>Metadata</b><br/>artist, title, date,<br/>accession number"]
  R --> C["<b>Captions</b><br/>semantic / factual context"]
  R --> I["<b>Image<br/>embeddings</b><br/>visual similarity"]
  R --> P["<b>Colour</b><br/>colour terms / palette"]

  K --> F["<b>Reciprocal rank<br/>fusion</b><br/>(RRF)"]
  M --> F
  C --> F
  I --> F
  P --> F

  F --> O["Ranked results"]

  classDef input fill:#111116,stroke:#3f3f46,color:#f8f7f4
  classDef route fill:#1f2937,stroke:#64748b,color:#f8f7f4
  classDef keyword fill:#24213a,stroke:#7c6ee6,color:#f8f7f4
  classDef metadata fill:#223026,stroke:#6aa56f,color:#f8f7f4
  classDef captions fill:#30223b,stroke:#a06ac4,color:#f8f7f4
  classDef image fill:#332821,stroke:#c08a57,color:#f8f7f4
  classDef colour fill:#243238,stroke:#61a4b5,color:#f8f7f4
  classDef fusion fill:#3a2530,stroke:#c4718f,color:#f8f7f4
  class Q,O input
  class R route
  class K keyword
  class M metadata
  class C captions
  class I image
  class P colour
  class F fusion`;

const sectionClassName = 'border-t border-white/[0.08] py-10 md:py-12';
const headingClassName =
  'font-display text-3xl font-semibold tracking-normal text-white md:text-4xl';
const bodyClassName =
  'mt-5 max-w-4xl text-base leading-8 text-white/68 md:text-lg md:leading-9';

function MermaidDiagram({ chart }: { chart: string }) {
  const renderId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function renderDiagram() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'dark',
          flowchart: {
            curve: 'basis',
            htmlLabels: true,
            nodeSpacing: 32,
            rankSpacing: 34,
            useMaxWidth: true,
          },
          themeVariables: {
            background: 'transparent',
            fontFamily:
              'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: '16px',
            lineColor: 'rgba(255,255,255,0.55)',
            mainBkg: '#17171b',
            primaryBorderColor: 'rgba(255,255,255,0.22)',
            primaryTextColor: '#f8f7f4',
          },
        });

        const { svg } = await mermaid.render(
          `about-search-flow-${renderId}`,
          chart
        );
        if (isMounted && containerRef.current) {
          containerRef.current.innerHTML = svg;
          const renderedSvg = containerRef.current.querySelector('svg');
          if (renderedSvg) {
            renderedSvg.removeAttribute('width');
            renderedSvg.removeAttribute('height');
            renderedSvg.style.width = '100%';
            renderedSvg.style.maxWidth = '100%';
            renderedSvg.style.height = 'auto';
          }
          setRenderError(false);
        }
      } catch {
        if (isMounted) {
          setRenderError(true);
        }
      }
    }

    void renderDiagram();

    return () => {
      isMounted = false;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [chart, renderId]);

  return (
    <div className="mt-8 overflow-hidden rounded-lg border border-white/[0.1] bg-white/[0.035] p-4 md:p-6">
      {renderError ? (
        <pre className="whitespace-pre-wrap text-sm leading-6 text-white/70">
          {chart}
        </pre>
      ) : (
        <div
          ref={containerRef}
          className="min-h-[220px] w-full [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-full"
        />
      )}
    </div>
  );
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0e] text-white">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#0b0b0e]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-end justify-between px-5 pb-3 lg:px-8">
          <div className="flex min-w-0 items-end gap-4">
            <Link
              to="/ngs/search"
              className="inline-flex items-end transition-opacity hover:opacity-80"
            >
              <Logo size="sm" framed />
            </Link>
            <span className="pb-[3px] text-sm font-medium leading-none text-white/70">
              About
            </span>
          </div>
          <Link
            to="/ngs/search"
            className="rounded-md border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            Search
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-20">
        <h1 className="font-display text-6xl font-semibold tracking-normal text-white md:text-7xl">
          About
        </h1>

        <section className="mt-12 py-4 md:mt-16">
          <h2 className={headingClassName}>Why I built this</h2>
          <p className={bodyClassName}>
            Cause why not? I wanted to maximise token use on my AI
            subscriptions.
          </p>
        </section>

        <section className={sectionClassName}>
          <h2 className={headingClassName}>Context</h2>
          <p className={bodyClassName}>
            Public art collections are interesting because the data is visual,
            textual, and messy. People search collections in different ways:
            researchers look for names, dates, and accession numbers; marketing
            teams look for themes; artists look for mood, colour, and form;
            casual users ask loose questions.
          </p>
        </section>

        <section className={sectionClassName}>
          <h2 className={headingClassName}>Data</h2>
          <p className={bodyClassName}>
            To make the index more comprehensive, we gathered publicly available
            data from{' '}
            <a
              href="https://www.nationalgallery.sg/sg/en/our-collections/search-collection.html"
              className="text-white underline decoration-white/30 underline-offset-4 transition-colors hover:text-white/80"
            >
              National Gallery Singapore
            </a>{' '}
            and{' '}
            <a
              href="https://www.roots.gov.sg/Collection-Landing"
              className="text-white underline decoration-white/30 underline-offset-4 transition-colors hover:text-white/80"
            >
              Roots
            </a>
            .
          </p>
        </section>

        <section className={sectionClassName}>
          <h2 className={headingClassName}>Approach</h2>
          <p className={bodyClassName}>
            In order to support different ways of searching the collection,
            Paillette routes each query to the search channels that make sense,
            then combines their ranked results with reciprocal rank fusion
            (RRF). RRF gives more weight to results that appear near the top of
            one or more relevant channels, so the final ranking is not dependent
            on a single model score.
          </p>
          <p className={bodyClassName}>
            For example, an accession number leans on metadata. "Blue abstract
            painting" leans on colour and image similarity. "Works about
            migration" leans on captions and keywords.
          </p>

          <MermaidDiagram chart={searchFlowDiagram} />
        </section>

        <section className={sectionClassName}>
          <h2 className={headingClassName}>Limitations</h2>
          <p className={bodyClassName}>
            Paillette can only search what is in the corpus. If there are no
            relevant works for something like "Dragon Boat Festival", the
            results will not magically become correct.
          </p>
          <p className={bodyClassName}>
            Future work could include query expansion, alternative query
            generation, and clearer "no strong match" handling.
          </p>
        </section>
      </main>
    </div>
  );
}
