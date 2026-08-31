import type { ReactNode } from 'react';

const microLabelClassName =
  'font-mono text-[10px] uppercase tracking-[0.18em] text-white/60';

const pipelineStages = [
  {
    title: 'Normalize the string',
    mechanism:
      'Unicode NFKD folding removes diacritics. The parser lowercases text, expands negative contractions, turns dash characters into word boundaries, removes other punctuation, and collapses whitespace.',
    example: '“PAINTINGS—before 1800!” → “paintings before 1800”',
  },
  {
    title: 'Parse displayed time',
    mechanism:
      'Date grammar recognises exact years, before/after boundaries, year spans, decades, centuries, early/mid/late modifiers, and circa ranges. An exact-year token is rejected when accession, object, or id appears immediately before it.',
    example: '“before 1800” → dateRange: 1000–1799',
  },
  {
    title: 'Extract catalogue metadata',
    mechanism:
      'Controlled classification and medium vocabularies match longest phrases first, then individual tokens. Longer misspellings are corrected only when bounded edit distance finds one unambiguous vocabulary match. Matched spans become hard filters and are removed from descriptive text.',
    example:
      '“oil paintngs” → classification: Painting · medium: oil · correction: paintngs → painting',
  },
  {
    title: 'Resolve artwork relationships',
    mechanism:
      'The parser finds artwork-classification spans on each side of connectors such as showing, with, depicted in, or based on. The connector determines which side is the returned work and which side is its subject or source. An ambiguous relationship is left unresolved instead of being guessed.',
    example: '“painting showing a sculpture” → Painting —depicts→ Sculpture',
  },
  {
    title: 'Resolve artist attribution',
    mechanism:
      'Ordered patterns distinguish by, after, attributed to, workshop of, studio of, circle of, school of, and follower of. The parser extracts the named target up to any later date or catalogue constraint and preserves the exact relationship.',
    example:
      '“drawings attributed to Rembrandt” → attributed_to · target: Rembrandt',
  },
  {
    title: 'Build the semantic remainder',
    mechanism:
      'After recognised dates, classifications, media, and control words are removed, the words left over become retrieval text. This remainder guides keyword, caption, and visual ranking; it is not a hard catalogue filter.',
    example:
      '“oil paintings of ships before 1800” − structured spans → “ships”',
  },
  {
    title: 'Compile one search plan',
    mechanism:
      'The compiler chooses semantic, structured, relational, or attribution mode. Hybrid retrieval modes send text to the relevant search channels, enforce hard constraints, and combine rankings with RRF. Relation and attribution modes apply their own catalogue-evidence checks.',
    example:
      'plan = mode + retrievalQuery + constraints + relationship/evidence policy',
  },
] as const;

type TraceRow = {
  operation: string;
  consumes: string;
  output: ReactNode;
};

function QueryTrace({
  label,
  query,
  rows,
}: {
  label: string;
  query: string;
  rows: TraceRow[];
}) {
  return (
    <article className="border-t border-white/[0.1] px-5 py-6 md:px-6 md:py-7">
      <p className={microLabelClassName}>{label}</p>
      <h3 className="mt-2 font-display text-2xl font-medium leading-tight text-white md:text-3xl">
        {query}
      </h3>

      <div className="mt-5 border-y border-white/[0.1]">
        <table className="w-full border-collapse text-left">
          <thead className="hidden border-b border-white/[0.08] md:table-header-group">
            <tr className={microLabelClassName}>
              <th scope="col" className="w-[23%] py-2.5 pr-5 font-normal">
                Parser operation
              </th>
              <th scope="col" className="w-[28%] py-2.5 pr-5 font-normal">
                Consumes
              </th>
              <th scope="col" className="py-2.5 font-normal">
                Emits
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.08]">
          {rows.map((row) => (
            <tr
              key={`${query}-${row.operation}`}
              className="grid gap-2 py-4 md:table-row"
            >
              <th
                scope="row"
                className="block text-left text-sm font-medium leading-6 text-cyan-100/90 md:table-cell md:w-[23%] md:py-4 md:pr-5 md:align-top md:text-base"
              >
                <span className={`${microLabelClassName} mb-1 block md:hidden`}>
                  Parser operation
                </span>
                {row.operation}
              </th>
              <td className="block font-display text-lg leading-7 text-white md:table-cell md:w-[28%] md:py-4 md:pr-5 md:align-top">
                <span className={`${microLabelClassName} mb-1 block md:hidden`}>
                  Consumes
                </span>
                {row.consumes}
              </td>
              <td className="block text-sm leading-6 text-white/72 md:table-cell md:py-4 md:align-top md:text-base md:leading-7">
                <span className={`${microLabelClassName} mb-1 block md:hidden`}>
                  Emits
                </span>
                {row.output}
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function OutputLine({ children }: { children: ReactNode }) {
  return (
    <code className="block font-mono text-[12px] leading-6 text-white/82 md:text-sm">
      {children}
    </code>
  );
}

export function QueryInterpretationDiagram() {
  return (
    <figure
      aria-labelledby="query-interpretation-caption"
      className="mt-8 overflow-hidden rounded-xl border border-white/[0.1] bg-white/[0.025]"
    >
      <figcaption
        id="query-interpretation-caption"
        className="border-b border-white/[0.1] px-5 py-5 md:px-6"
      >
        <span className="block font-display text-xl font-medium text-white md:text-2xl">
          How the NGA parser unpacks a query
        </span>
        <span className="mt-1 block max-w-3xl text-sm leading-6 text-white/60 md:text-base md:leading-7">
          This is a deterministic text parser, not one generic tagging step.
          Each stage uses a different rule and produces a different part of the
          final search plan.
        </span>
      </figcaption>

      <section aria-labelledby="parser-stages-heading" className="px-5 py-6 md:px-6">
        <h3
          id="parser-stages-heading"
          className="font-display text-xl font-medium text-white md:text-2xl"
        >
          Parser stages
        </h3>
        <ol className="mt-4 border-y border-white/[0.1]">
          {pipelineStages.map((stage, index) => (
            <li
              key={stage.title}
              className="grid gap-3 border-b border-white/[0.08] py-4 last:border-b-0 md:grid-cols-[2.5rem_minmax(0,0.8fr)_minmax(0,1.8fr)] md:gap-5"
            >
              <span
                aria-hidden="true"
                className="font-mono text-xs leading-7 text-cyan-100/75"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <p className="text-base font-medium leading-7 text-white">
                  {stage.title}
                </p>
                <p className={`${microLabelClassName} mt-1`}>Rule</p>
              </div>
              <div>
                <p className="text-sm leading-6 text-white/72 md:text-base md:leading-7">
                  {stage.mechanism}
                </p>
                <code className="mt-2 block border-l border-cyan-100/25 pl-3 font-mono text-[12px] leading-6 text-cyan-50/80 md:text-sm">
                  {stage.example}
                </code>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <QueryTrace
        label="Trace 1 · metadata + time + semantic text"
        query="oil paintings of ships before 1800"
        rows={[
          {
            operation: 'Date grammar',
            consumes: 'before 1800',
            output: <OutputLine>dateRange: 1000–1799</OutputLine>,
          },
          {
            operation: 'Vocabulary matcher',
            consumes: 'oil paintings',
            output: (
              <>
                <OutputLine>classification: Painting</OutputLine>
                <OutputLine>medium: oil</OutputLine>
              </>
            ),
          },
          {
            operation: 'Span subtraction',
            consumes: 'ships',
            output: <OutputLine>retrievalQuery: “ships”</OutputLine>,
          },
          {
            operation: 'Compiler',
            consumes: 'all outputs',
            output:
              'Structured mode: enforce the three catalogue filters first, then rank the remaining works for ships.',
          },
        ]}
      />

      <QueryTrace
        label="Trace 2 · directional grammar"
        query="painting showing a sculpture"
        rows={[
          {
            operation: 'Classification spans',
            consumes: 'painting · sculpture',
            output:
              'The left classification is the returned work; the right classification is the depicted subject.',
          },
          {
            operation: 'Connector matcher',
            consumes: 'showing',
            output: <OutputLine>Painting —depicts→ Sculpture</OutputLine>,
          },
          {
            operation: 'Relation compiler',
            consumes: 'all three spans',
            output: (
              <>
                <OutputLine>hard filter: classification = Painting</OutputLine>
                <OutputLine>
                  retrievalQuery: “painting depicting sculpture”
                </OutputLine>
              </>
            ),
          },
          {
            operation: 'Evidence gate',
            consumes: 'ranked candidates',
            output:
              'The subject is evidence-checked, not returned as a Sculpture result.',
          },
        ]}
      />

      <QueryTrace
        label="Trace 3 · catalogue attribution"
        query="drawings attributed to Rembrandt"
        rows={[
          {
            operation: 'Vocabulary matcher',
            consumes: 'drawings',
            output: <OutputLine>hard filter: classification = Drawing</OutputLine>,
          },
          {
            operation: 'Ordered marker match',
            consumes: 'attributed to',
            output: <OutputLine>relationship: attributed_to</OutputLine>,
          },
          {
            operation: 'Target extraction',
            consumes: 'Rembrandt',
            output: <OutputLine>target: Rembrandt</OutputLine>,
          },
          {
            operation: 'Evidence gate',
            consumes: 'ranked candidates',
            output:
              'Matching catalogue attribution evidence is required; visual resemblance alone is not enough.',
          },
        ]}
      />
    </figure>
  );
}
