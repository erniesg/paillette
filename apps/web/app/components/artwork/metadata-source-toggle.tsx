import { Link } from '@remix-run/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SourceIndicator } from '~/components/artwork/source-indicator';
import type { PublicMetadataGroup } from '~/lib/public-artwork-metadata';
import { cn } from '~/lib/utils';

type MetadataSourceToggleProps = {
  groups: PublicMetadataGroup[];
  getSearchHref?: (label: string, value: string) => string | null;
  className?: string;
};

const getGroupKey = (groups: PublicMetadataGroup[]) =>
  groups
    .map(
      (group) =>
        `${group.id}:${group.sourceLabel}:${group.rows
          .map((row) => `${row.label}:${row.value}:${row.sourceLabel}`)
          .join('|')}`
    )
    .join('\n');

export function MetadataSourceToggle({
  groups,
  getSearchHref,
  className,
}: MetadataSourceToggleProps) {
  const options = useMemo(
    () => groups.filter((group) => group.rows.length > 0),
    [groups]
  );
  const preferredId = options[0]?.id ?? null;
  const groupKey = getGroupKey(options);
  const [activeId, setActiveId] = useState<string | null>(preferredId);
  const [hasManualSelection, setHasManualSelection] = useState(false);
  const previousGroupKey = useRef(groupKey);
  const activeGroup =
    options.find((option) => option.id === activeId) || options[0];

  useEffect(() => {
    const groupsChanged = previousGroupKey.current !== groupKey;
    if (groupsChanged) {
      previousGroupKey.current = groupKey;
      setHasManualSelection(false);
    }

    if (!preferredId) {
      if (activeId !== null) setActiveId(null);
      return;
    }

    const activeStillExists = options.some((option) => option.id === activeId);
    if (!activeStillExists) {
      setActiveId(preferredId);
      setHasManualSelection(false);
      return;
    }

    if ((groupsChanged || !hasManualSelection) && activeId !== preferredId) {
      setActiveId(preferredId);
    }
  }, [activeId, groupKey, hasManualSelection, options, preferredId]);

  if (!activeGroup) return null;

  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
            Catalogue fields
          </h3>
          <SourceIndicator label={activeGroup.sourceLabel} compact showLabel />
        </div>

        {options.length > 1 && (
          <div className="inline-flex shrink-0 rounded-md border border-white/10 bg-black/25 p-0.5">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === activeGroup.id}
                onClick={() => {
                  setActiveId(option.id);
                  setHasManualSelection(true);
                }}
                className={cn(
                  'rounded px-2.5 py-1.5 text-xs font-medium text-white/55 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                  option.id === activeGroup.id &&
                    'bg-white/12 text-white shadow-sm'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        {activeGroup.rows.map(({ label, value, sourceLabel }) => {
          const href = getSearchHref?.(label, value);

          return (
            <div
              key={`${label}:${value}`}
              className="rounded-md border border-white/[0.08] bg-black/20 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                  {label}
                </dt>
                {sourceLabel !== activeGroup.sourceLabel && (
                  <SourceIndicator label={sourceLabel} compact />
                )}
              </div>
              <dd className="mt-1 break-words text-sm text-white/75">
                {href ? (
                  <Link
                    to={href}
                    className="underline decoration-white/20 underline-offset-4 transition-colors hover:text-white hover:decoration-white/60"
                  >
                    {value}
                  </Link>
                ) : (
                  value
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
