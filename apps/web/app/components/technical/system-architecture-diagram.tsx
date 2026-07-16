type ArchitectureBand = {
  id: string;
  eyebrow: string;
  nodes: { title: string; detail: string; tone: string }[];
};

const architectureBands: ArchitectureBand[] = [
  {
    id: 'experience',
    eyebrow: 'Experience',
    nodes: [
      {
        title: 'Visitor browser',
        detail: 'Submits a search and displays the hydrated result set.',
        tone: 'border-sky-300/70',
      },
      {
        title: 'Remix web Worker',
        detail: 'Renders the experience and calls the search API.',
        tone: 'border-sky-300/70',
      },
    ],
  },
  {
    id: 'application',
    eyebrow: 'Application',
    nodes: [
      {
        title: 'Hono API Worker',
        detail: 'Authenticates, reserves usage, and coordinates retrieval.',
        tone: 'border-violet-300/70',
      },
    ],
  },
  {
    id: 'external-model-providers',
    eyebrow: 'External model providers',
    nodes: [
      {
        title: 'Jina embeddings',
        detail: 'Creates query vectors for semantic retrieval.',
        tone: 'border-amber-300/70',
      },
      {
        title: 'Workers AI',
        detail: 'Provides the alternate managed model path.',
        tone: 'border-amber-300/70',
      },
    ],
  },
  {
    id: 'retrieval-storage',
    eyebrow: 'Retrieval + storage',
    nodes: [
      {
        title: 'Vectorize · image/text',
        detail: 'Nearest-neighbour matches for visual and text embeddings.',
        tone: 'border-emerald-300/70',
      },
      {
        title: 'Vectorize · captions',
        detail: 'Caption-derived semantic matches.',
        tone: 'border-emerald-300/70',
      },
      {
        title: 'D1 · metadata + usage',
        detail: 'Artwork metadata, hydration records, and usage accounting.',
        tone: 'border-emerald-300/70',
      },
      {
        title: 'Configured asset URLs',
        detail:
          'Artwork images resolve from configured asset URLs, including R2-backed assets.',
        tone: 'border-emerald-300/70',
      },
    ],
  },
];

const requestSteps = [
  'Submit: the visitor sends a text query.',
  'Authenticate and reserve: the API validates access and reserves usage.',
  'Route: the API selects the query and model path.',
  'Embed when needed: only when the selected route needs vectors, Jina embeddings or Workers AI creates the query vector.',
  'Retrieve: selected Vectorize indexes and/or D1 return candidates.',
  'Fuse when needed: RRF combines ranked candidates only when multiple ranked sources participate.',
  'Hydrate: D1 adds artwork metadata to each candidate.',
  'Record and return: D1 records usage; the API returns ranked results and queryTime.',
  'Load images: the browser requests configured asset URLs, including R2-backed assets.',
];

export function SystemArchitectureDiagram(): JSX.Element {
  return (
    <figure
      aria-labelledby="architecture-title"
      className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70 text-slate-100"
    >
      <div className="border-b border-white/10 px-5 py-5 sm:px-7">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/70">
          Request lifecycle
        </p>
        <h2
          id="architecture-title"
          className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl"
        >
          Paillette request architecture
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
          Runtime boundaries and the complete path from a visitor query to
          ranked, hydrated artwork.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_0.8fr_0.95fr_1.5fr]">
        {architectureBands.map((band, index) => (
          <section
            key={band.id}
            aria-labelledby={`${band.id}-title`}
            className="relative border-b border-white/10 px-5 py-6 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"
          >
            <h3
              id={`${band.id}-title`}
              className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
            >
              {band.eyebrow}
            </h3>

            <div className="mt-4 space-y-3">
              {band.nodes.map((node) => (
                <div
                  key={node.title}
                  className={`border-l-2 py-1 pl-3 ${node.tone}`}
                >
                  <p className="text-sm font-semibold text-white">
                    {node.title}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {node.detail}
                  </p>
                </div>
              ))}
            </div>

            {index < architectureBands.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-slate-900 text-sm text-cyan-200 lg:bottom-auto lg:left-auto lg:right-0 lg:top-1/2 lg:translate-x-1/2 lg:-translate-y-1/2"
              >
                <span className="lg:hidden">↓</span>
                <span className="hidden lg:inline">→</span>
              </span>
            ) : null}
          </section>
        ))}
      </div>

      <figcaption className="border-t border-white/10 bg-white/[0.025] px-5 py-6 sm:px-7">
        <h3 className="text-sm font-semibold text-white">
          Routed hybrid text-search hot path
        </h3>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-400">
          The selected route determines which optional embedding, retrieval, and
          fusion operations participate.
        </p>
        <ol className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {requestSteps.map((step, index) => (
            <li
              key={step}
              className="flex gap-3 text-sm leading-6 text-slate-300"
            >
              <span
                aria-hidden="true"
                className="font-mono text-xs tabular-nums text-cyan-200/70"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
