import { useState } from 'react';

const microLabelClassName =
  'font-mono text-[10px] uppercase tracking-[0.18em] text-white/60';

type DetailId =
  | 'meaning'
  | 'medium'
  | 'classification'
  | 'time'
  | 'relationship'
  | 'attribution';

type ExampleId = 'filters' | 'relationship' | 'attribution';

type QuerySegment = {
  text: string;
  label: string;
  detailId: DetailId;
  connectorBefore?: string;
};

const detailTone: Record<DetailId, { idle: string; active: string }> = {
  meaning: {
    idle: 'border-violet-300/35 text-violet-100/75 hover:border-violet-300/75 hover:text-violet-50',
    active: 'border-violet-300 bg-violet-300/[0.09] text-violet-50',
  },
  medium: {
    idle: 'border-cyan-200/35 text-cyan-100/75 hover:border-cyan-200/75 hover:text-cyan-50',
    active: 'border-cyan-200 bg-cyan-200/[0.08] text-cyan-50',
  },
  classification: {
    idle: 'border-cyan-200/35 text-cyan-100/75 hover:border-cyan-200/75 hover:text-cyan-50',
    active: 'border-cyan-200 bg-cyan-200/[0.08] text-cyan-50',
  },
  time: {
    idle: 'border-amber-200/35 text-amber-100/75 hover:border-amber-200/75 hover:text-amber-50',
    active: 'border-amber-200 bg-amber-200/[0.08] text-amber-50',
  },
  relationship: {
    idle: 'border-rose-200/35 text-rose-100/75 hover:border-rose-200/75 hover:text-rose-50',
    active: 'border-rose-200 bg-rose-200/[0.08] text-rose-50',
  },
  attribution: {
    idle: 'border-emerald-200/35 text-emerald-100/75 hover:border-emerald-200/75 hover:text-emerald-50',
    active: 'border-emerald-200 bg-emerald-200/[0.08] text-emerald-50',
  },
};

const partDetails: Record<
  DetailId,
  { title: string; outcome: string; explanation: string }
> = {
  meaning: {
    title: 'Descriptive meaning',
    outcome: 'Semantic retrieval · ships',
    explanation:
      'Ships supplies the descriptive retrieval text. The oil, Painting, and displayed-date constraints still apply to every candidate.',
  },
  medium: {
    title: 'Catalogue metadata',
    outcome: 'Hard filter · medium is oil',
    explanation:
      'Oil stays relevant as a hard filter. It moves out of the free-text phrase because the catalogue constraint already enforces it.',
  },
  classification: {
    title: 'Catalogue metadata',
    outcome: 'Hard filter · classification is Painting',
    explanation:
      'Painting stays relevant as a hard catalogue filter. Only paintings remain eligible before semantic ranking begins.',
  },
  time: {
    title: 'Displayed time',
    outcome: 'Hard displayed-date range · 1000–1799',
    explanation:
      'Before 1800 becomes an exclusive displayed-date boundary. Candidates outside 1000–1799 are removed before ranking.',
  },
  relationship: {
    title: 'Artwork relationship',
    outcome: 'Return paintings · require depicted sculpture',
    explanation:
      'Showing fixes the direction: the result must be a painting, while sculpture is the depicted subject that needs evidence.',
  },
  attribution: {
    title: 'Artist attribution',
    outcome: 'Catalogue evidence · direct relationship to Rembrandt',
    explanation:
      'By Rembrandt asks for a direct catalogue attribution. This is a separate parser mode from artwork relationships.',
  },
};

const queryExamples: Record<
  ExampleId,
  {
    label: string;
    defaultDetailId: DetailId;
    segments: QuerySegment[];
  }
> = {
  filters: {
    label: 'Filters + meaning',
    defaultDetailId: 'meaning',
    segments: [
      { text: 'oil', label: 'Medium filter', detailId: 'medium' },
      {
        text: 'paintings',
        label: 'Classification filter',
        detailId: 'classification',
        connectorBefore: ' ',
      },
      {
        text: 'ships',
        label: 'Descriptive meaning',
        detailId: 'meaning',
        connectorBefore: ' of ',
      },
      {
        text: 'before 1800',
        label: 'Displayed time',
        detailId: 'time',
        connectorBefore: ' ',
      },
    ],
  },
  relationship: {
    label: 'Artwork relationship',
    defaultDetailId: 'relationship',
    segments: [
      {
        text: 'painting',
        label: 'Returned classification',
        detailId: 'classification',
      },
      {
        text: 'showing',
        label: 'Relationship connector',
        detailId: 'relationship',
        connectorBefore: ' ',
      },
      {
        text: 'a sculpture',
        label: 'Depicted subject',
        detailId: 'relationship',
        connectorBefore: ' ',
      },
    ],
  },
  attribution: {
    label: 'Artist attribution',
    defaultDetailId: 'attribution',
    segments: [
      { text: 'oil', label: 'Medium filter', detailId: 'medium' },
      {
        text: 'paintings',
        label: 'Classification filter',
        detailId: 'classification',
        connectorBefore: ' ',
      },
      {
        text: 'by Rembrandt',
        label: 'Artist attribution',
        detailId: 'attribution',
        connectorBefore: ' ',
      },
    ],
  },
};

const planParts = [
  {
    part: 'Descriptive meaning',
    source: 'Words remaining after structured phrases move into hard constraints',
    example: '“oil paintings of ships before 1800” → “ships”',
    output: 'Semantic retrieval: ships',
  },
  {
    part: 'Catalogue metadata',
    source: 'Controlled classification and medium vocabularies',
    example: '“oil paintings”',
    output: 'Hard filters: Painting · oil',
  },
  {
    part: 'Displayed time',
    source: 'Date grammar: years, ranges, before/after, decades, centuries, circa',
    example: '“before 1800”',
    output: 'Hard displayed-date range: 1000–1799',
  },
  {
    part: 'Artwork relationship',
    source: 'Directional connectors such as showing, with, depicted in, or based on',
    example: '“painting showing a sculpture”',
    output: 'Return paintings · require depicted sculpture',
  },
  {
    part: 'Artist attribution',
    source: 'Ordered phrases such as by, after, attributed to, workshop, circle, or follower',
    example: '“oil paintings by Rembrandt”',
    output: 'Catalogue relation: directly by Rembrandt',
  },
] as const;

export function QueryInterpretationDiagram() {
  const [exampleId, setExampleId] = useState<ExampleId>('filters');
  const [pinnedDetailId, setPinnedDetailId] = useState<DetailId>('meaning');
  const [previewDetailId, setPreviewDetailId] = useState<DetailId | null>(null);
  const activeDetailId = previewDetailId ?? pinnedDetailId;
  const activeExample = queryExamples[exampleId];
  const activeDetail = partDetails[activeDetailId];

  const selectExample = (nextId: ExampleId) => {
    setExampleId(nextId);
    setPinnedDetailId(queryExamples[nextId].defaultDetailId);
    setPreviewDetailId(null);
  };

  return (
    <figure
      aria-labelledby="query-interpretation-caption"
      className="mt-7 overflow-hidden rounded-xl border border-white/[0.1] bg-white/[0.025]"
    >
      <figcaption
        id="query-interpretation-caption"
        className="border-b border-white/[0.1] px-5 py-4 md:px-6"
      >
        <span className="block font-display text-xl font-medium text-white md:text-2xl">
          What an NGA query is deconstructed into
        </span>
        <span className="mt-1 block text-sm leading-6 text-white/60 md:text-base">
          Select a labelled phrase to see how it changes the search plan.
        </span>
      </figcaption>

      <div
        role="tablist"
        aria-label="Query examples"
        className="flex gap-5 overflow-x-auto border-b border-white/[0.1] px-5 md:px-6"
      >
        {(Object.keys(queryExamples) as ExampleId[]).map((id) => (
          <button
            key={id}
            id={`query-example-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={exampleId === id}
            aria-controls="query-example-panel"
            onClick={() => selectExample(id)}
            className={`shrink-0 border-b-2 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 ${
              exampleId === id
                ? 'border-white text-white'
                : 'border-transparent text-white/55 hover:text-white/85'
            }`}
          >
            {queryExamples[id].label}
          </button>
        ))}
      </div>

      <div
        id="query-example-panel"
        role="tabpanel"
        aria-labelledby={`query-example-tab-${exampleId}`}
        className="px-5 py-5 md:px-6 md:py-6"
      >
        <div className="flex flex-wrap items-start gap-y-4">
          {activeExample.segments.map((segment) => {
            const isActive = activeDetailId === segment.detailId;
            const isPinned = pinnedDetailId === segment.detailId;
            const tone = detailTone[segment.detailId];

            return (
              <span key={`${exampleId}-${segment.text}`} className="inline-flex items-start">
                {segment.connectorBefore ? (
                  <span className="px-1 pt-1 font-display text-2xl leading-tight text-white/48 md:text-3xl">
                    {segment.connectorBefore}
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={`${segment.text} — ${segment.label}`}
                  aria-pressed={isPinned}
                  aria-controls="query-part-detail"
                  onMouseEnter={() => setPreviewDetailId(segment.detailId)}
                  onMouseLeave={() => setPreviewDetailId(null)}
                  onFocus={() => setPreviewDetailId(segment.detailId)}
                  onBlur={() => setPreviewDetailId(null)}
                  onClick={() => setPinnedDetailId(segment.detailId)}
                  className={`inline-flex min-h-12 flex-col items-start border-b-2 px-1 pb-1.5 pt-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                    isActive ? tone.active : tone.idle
                  }`}
                >
                  <span className="font-display text-2xl leading-tight md:text-3xl">
                    {segment.text}
                  </span>
                  <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] opacity-75 md:text-[10px]">
                    {segment.label}
                  </span>
                </button>
              </span>
            );
          })}
        </div>
        <p className="mt-4 text-xs leading-5 text-white/50">
          Hover or focus to preview. Click to keep a part selected. Artwork
          relationship and artist attribution are separate parser modes.
        </p>
      </div>

      <section
        id="query-part-detail"
        role="region"
        aria-labelledby="query-part-detail-heading"
        aria-live="polite"
        className="grid gap-3 border-t border-white/[0.1] px-5 py-4 md:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] md:px-6"
      >
        <div>
          <p className={microLabelClassName}>Selected part</p>
          <h3
            id="query-part-detail-heading"
            className="mt-1 font-display text-xl font-medium text-white"
          >
            {activeDetail.title}
          </h3>
        </div>
        <div>
          <p className="font-mono text-xs leading-6 text-cyan-50/85 md:text-sm">
            {activeDetail.outcome}
          </p>
          <p className="mt-1 text-sm leading-6 text-white/68">
            {activeDetail.explanation}
          </p>
        </div>
      </section>

      <details
        data-testid="query-part-details"
        className="group border-t border-white/[0.1]"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-200/70 md:px-6">
          <span>View all details</span>
          <span
            aria-hidden="true"
            className="text-lg leading-none transition-transform group-open:rotate-45"
          >
            +
          </span>
        </summary>
        <div className="border-t border-white/[0.08]">
          <table className="w-full border-collapse text-left">
            <thead className="hidden border-b border-white/[0.08] sm:table-header-group">
              <tr className={microLabelClassName}>
                <th scope="col" className="w-[22%] px-6 py-2.5 font-normal">
                  Plan part
                </th>
                <th scope="col" className="w-[43%] px-6 py-2.5 font-normal">
                  How it is found
                </th>
                <th scope="col" className="px-6 py-2.5 font-normal">
                  What it controls
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.08]">
              {planParts.map((row) => (
                <tr key={row.part} className="grid gap-2 px-5 py-4 sm:table-row sm:px-0">
                  <th
                    scope="row"
                    className="block text-left text-sm font-medium text-white sm:table-cell sm:w-[22%] sm:px-6 sm:py-4 sm:align-top"
                  >
                    {row.part}
                  </th>
                  <td className="block sm:table-cell sm:w-[43%] sm:px-6 sm:py-4 sm:align-top">
                    <span className={`${microLabelClassName} mb-1 block sm:hidden`}>
                      How it is found
                    </span>
                    <p className="text-sm leading-6 text-white/68">{row.source}</p>
                    <p className="mt-1 font-display text-base leading-6 text-white">
                      {row.example}
                    </p>
                  </td>
                  <td className="block sm:table-cell sm:px-6 sm:py-4 sm:align-top">
                    <span className={`${microLabelClassName} mb-1 block sm:hidden`}>
                      What it controls
                    </span>
                    <code className="block font-mono text-[12px] leading-6 text-cyan-50/85 md:text-sm">
                      {row.output}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
