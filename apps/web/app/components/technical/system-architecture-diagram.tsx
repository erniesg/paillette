const stages = [
  {
    label: 'Experience',
    tone: 'border-sky-300/60',
    nodes: ['Visitor', 'Remix web'],
  },
  {
    label: 'Orchestration',
    tone: 'border-violet-300/60',
    nodes: ['Hono API'],
  },
  {
    label: 'Retrieval',
    tone: 'border-amber-300/60',
    nodes: ['Jina / Workers AI', 'Vectorize', 'D1'],
  },
  {
    label: 'Delivery',
    tone: 'border-emerald-300/60',
    nodes: ['Ranked artworks', 'Artwork assets'],
  },
] as const;

export function SystemArchitectureDiagram(): JSX.Element {
  return (
    <figure
      aria-label="Paillette system architecture"
      className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70 text-slate-100"
    >
      <div className="grid grid-cols-1 lg:grid-cols-4">
        {stages.map((stage, index) => (
          <section
            key={stage.label}
            className="relative border-b border-white/10 px-5 py-6 last:border-b-0 lg:min-h-52 lg:border-b-0 lg:border-r lg:last:border-r-0"
          >
            <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
              {stage.label}
            </h3>

            <div className="mt-5 grid gap-3">
              {stage.nodes.map((node) => (
                <div
                  key={node}
                  className={`flex min-h-14 items-center border-l-2 bg-white/[0.025] px-4 py-3 text-sm font-semibold text-white ${stage.tone}`}
                >
                  {node}
                </div>
              ))}
            </div>

            {index < stages.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-1/2 z-10 flex h-7 w-7 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-slate-900 text-cyan-200 lg:bottom-auto lg:left-auto lg:right-0 lg:top-1/2 lg:translate-x-1/2 lg:-translate-y-1/2"
              >
                <span className="lg:hidden">↓</span>
                <span className="hidden lg:inline">→</span>
              </span>
            ) : null}
          </section>
        ))}
      </div>
    </figure>
  );
}
