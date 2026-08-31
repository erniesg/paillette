const microLabelClassName =
  'font-mono text-[10px] uppercase tracking-[0.18em] text-white/60';

const planParts = [
  {
    part: 'Descriptive meaning',
    source: 'Words left after structured phrases are removed',
    example: '“oil paintings of ships before 1800” → “ships”',
    outputs: ['retrievalQuery: “ships”'],
  },
  {
    part: 'Catalogue metadata',
    source: 'Controlled classification and medium vocabularies',
    example: '“oil paintings”',
    outputs: ['classification: Painting', 'medium: oil'],
  },
  {
    part: 'Displayed time',
    source: 'Date grammar: years, ranges, before/after, decades, centuries, circa',
    example: '“before 1800”',
    outputs: ['dateRange: 1000–1799'],
  },
  {
    part: 'Artwork relationship',
    source: 'Directional connectors such as showing, with, depicted in, or based on',
    example: '“painting showing a sculpture”',
    outputs: ['return: Painting', 'depicts: Sculpture'],
  },
  {
    part: 'Artist attribution',
    source: 'Ordered phrases such as by, after, attributed to, workshop, circle, or follower',
    example: '“drawings attributed to Rembrandt”',
    outputs: ['relationship: attributed_to', 'target: Rembrandt'],
  },
] as const;

export function QueryInterpretationDiagram() {
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
          What a query is deconstructed into
        </span>
        <span className="mt-1 block text-sm leading-6 text-white/60 md:text-base">
          Five possible parts, each found by a different kind of rule.
        </span>
      </figcaption>

      <div className="grid items-center gap-2 border-b border-white/[0.1] px-5 py-3 text-sm text-white/70 sm:grid-cols-[1fr_auto_1fr_auto_1fr] md:px-6">
        <span>Raw query</span>
        <span aria-hidden="true" className="hidden text-cyan-100/45 sm:block">
          →
        </span>
        <span>Clean case, punctuation, and dashes</span>
        <span aria-hidden="true" className="hidden text-cyan-100/45 sm:block">
          →
        </span>
        <span>Recognise typed parts</span>
      </div>

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
              Emitted field
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.08]">
          {planParts.map((row, index) => (
            <tr key={row.part} className="grid gap-2 px-5 py-4 sm:table-row sm:px-0">
              <th
                scope="row"
                className="block text-left sm:table-cell sm:w-[22%] sm:px-6 sm:py-4 sm:align-top"
              >
                <span className="mr-3 font-mono text-xs text-cyan-100/60">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-sm font-medium leading-6 text-white md:text-base">
                  {row.part}
                </span>
              </th>
              <td className="block sm:table-cell sm:w-[43%] sm:px-6 sm:py-4 sm:align-top">
                <span className={`${microLabelClassName} mb-1 block sm:hidden`}>
                  How it is found
                </span>
                <p className="text-sm leading-6 text-white/72">{row.source}</p>
                <p className="mt-1 font-display text-base leading-6 text-white">
                  {row.example}
                </p>
              </td>
              <td className="block sm:table-cell sm:px-6 sm:py-4 sm:align-top">
                <span className={`${microLabelClassName} mb-1 block sm:hidden`}>
                  Emitted field
                </span>
                {row.outputs.map((output) => (
                  <code
                    key={output}
                    className="block font-mono text-[12px] leading-6 text-cyan-50/85 md:text-sm"
                  >
                    {output}
                  </code>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
