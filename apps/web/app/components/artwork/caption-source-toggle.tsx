import { useEffect, useState } from 'react';
import { SourceIndicator } from '~/components/artwork/source-indicator';
import { cn } from '~/lib/utils';

type CaptionSource = {
  text?: string | null;
  sourceLabel: string;
  details?: Array<[string, unknown]>;
};

type CaptionOption = CaptionSource & {
  id: 'roots' | 'generated';
  label: string;
  text: string;
};

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const detailRows = (details: Array<[string, unknown]> = []) =>
  details.filter(
    ([, value]) => value !== null && value !== undefined && value !== ''
  );

const captionOption = (
  source: CaptionSource | null | undefined,
  id: CaptionOption['id'],
  label: string
): CaptionOption | null =>
  hasText(source?.text)
    ? {
        id,
        label,
        text: source.text,
        sourceLabel: source.sourceLabel,
        details: source.details,
      }
    : null;

export function CaptionSourceToggle({
  rootsCaption,
  generatedCaption,
  className,
}: {
  rootsCaption?: CaptionSource | null;
  generatedCaption?: CaptionSource | null;
  className?: string;
}) {
  const options = [
    captionOption(rootsCaption, 'roots', 'Roots catalogue'),
    captionOption(generatedCaption, 'generated', 'Generated caption'),
  ].filter((option): option is CaptionOption => Boolean(option));
  const [activeId, setActiveId] = useState<CaptionOption['id'] | null>(
    options[0]?.id ?? null
  );
  const activeOption =
    options.find((option) => option.id === activeId) || options[0];

  useEffect(() => {
    if (!options.some((option) => option.id === activeId) && options[0]) {
      setActiveId(options[0].id);
    }
  }, [activeId, options]);

  if (!activeOption) return null;

  const details = detailRows(activeOption.details);

  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
            Caption
          </h3>
          <SourceIndicator
            label={activeOption.sourceLabel}
            showLabel
            details={details}
          />
        </div>

        {options.length > 1 && (
          <div className="inline-flex shrink-0 rounded-md border border-white/10 bg-black/25 p-0.5">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === activeOption.id}
                onClick={() => setActiveId(option.id)}
                className={cn(
                  'rounded px-2.5 py-1.5 text-xs font-medium text-white/55 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                  option.id === activeOption.id &&
                    'bg-white/12 text-white shadow-sm'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-sm leading-relaxed text-white/72">
        {activeOption.text}
      </p>

      {details.length > 0 && (
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
                {label}
              </dt>
              <dd className="mt-1 break-words text-xs text-white/55">
                {String(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
