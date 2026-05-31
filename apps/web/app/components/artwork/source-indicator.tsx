import { useId, useMemo, useState } from 'react';
import {
  Archive,
  Building2,
  Database,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '~/lib/utils';

type SourceTone = 'institution' | 'roots' | 'metadata' | 'ai';

type SourceDetails = {
  title: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  tone: SourceTone;
};

type SourceIndicatorDetailRow = [string, unknown];

type SourceIndicatorProps = {
  label: string;
  compact?: boolean;
  showLabel?: boolean;
  className?: string;
  details?: SourceIndicatorDetailRow[];
};

const toneClasses: Record<SourceTone, string> = {
  institution: 'border-cyan-200/15 bg-cyan-200/[0.06] text-cyan-100',
  roots: 'border-amber-200/15 bg-amber-200/[0.06] text-amber-200',
  metadata: 'border-cyan-200/15 bg-cyan-200/[0.06] text-cyan-100',
  ai: 'border-primary-300/15 bg-primary-300/[0.06] text-primary-300',
};

const cleanSourceLabel = (label: string) =>
  label.replace(/^from\s+/i, '').trim();

const shouldShowDetailRow = ([label, value]: SourceIndicatorDetailRow) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  label.trim().toLowerCase() !== 'model';

export const getSourceIndicatorDetails = (label: string): SourceDetails => {
  const title = cleanSourceLabel(label) || 'Source metadata';
  const key = title.toLowerCase();

  if (
    key.includes('ngs source data') ||
    key.includes('stored ngs') ||
    key === 'ngs' ||
    key.includes('national gallery singapore') ||
    key.includes('art+')
  ) {
    return {
      title: 'NGS catalogue',
      shortLabel: 'NGS',
      description:
        'Catalogue text imported from National Gallery Singapore collection/API data.',
      tone: 'institution',
      icon: Building2,
    };
  }

  if (key.includes('roots') || key.includes('nhb')) {
    return {
      title: 'Roots catalogue',
      shortLabel: 'Roots',
      description: 'Catalogue text imported from Roots/NHB public records.',
      icon: Archive,
      tone: 'roots',
    };
  }

  if (key.includes('national museum singapore')) {
    return {
      title: 'National Museum of Singapore',
      shortLabel: 'NMS',
      description: 'Catalogue text imported through Roots/NHB public records.',
      icon: Archive,
      tone: 'roots',
    };
  }

  if (
    key.includes('paillette') ||
    key.includes('generated caption') ||
    key.includes('ai tag') ||
    key === 'ai'
  ) {
    return {
      title: 'Generated caption',
      shortLabel: 'AI',
      description:
        'Generated visual description used for search and discovery.',
      icon: Sparkles,
      tone: 'ai',
    };
  }

  return {
    title,
    shortLabel:
      key.includes('colour') || key.includes('dataset') ? 'DATA' : 'SRC',
    description: 'Source detail for this field.',
    icon: Database,
    tone: 'metadata',
  };
};

export function SourceIndicator({
  label,
  compact = false,
  showLabel = false,
  className,
  details,
}: SourceIndicatorProps) {
  const source = getSourceIndicatorDetails(label);
  const Icon = source.icon;
  const tooltip = `${source.title}: ${source.description}`;
  const popoverId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const visibleDetails = useMemo(
    () => (details ?? []).filter(shouldShowDetailRow),
    [details]
  );

  return (
    <span className="group/source relative inline-flex shrink-0">
      <button
        type="button"
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full border font-mono uppercase leading-none tracking-[0.12em] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
          compact ? 'px-1.5 py-1 text-[8px]' : 'px-2 py-1 text-[9px]',
          toneClasses[source.tone],
          className
        )}
        aria-label={`Source: ${tooltip}`}
        aria-describedby={popoverId}
        aria-expanded={isOpen}
        data-source-description={tooltip}
        onClick={() => setIsOpen((open) => !open)}
        onBlur={(event) => {
          if (
            !event.currentTarget.parentElement?.contains(
              event.relatedTarget as Node | null
            )
          ) {
            setIsOpen(false);
          }
        }}
      >
        <Icon
          aria-hidden="true"
          className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'}
        />
        <span>{showLabel ? source.title : source.shortLabel}</span>
      </button>
      <span
        id={popoverId}
        role="tooltip"
        className={cn(
          'absolute left-0 top-[calc(100%+0.5rem)] z-50 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-white/12 bg-[#111318] p-3 text-left font-sans normal-case leading-normal tracking-normal text-white/70 shadow-2xl shadow-black/40',
          isOpen
            ? 'pointer-events-auto visible'
            : 'pointer-events-none invisible group-hover/source:visible group-focus-within/source:visible'
        )}
      >
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
          {source.title}
        </span>
        <span className="mt-1 block text-xs leading-relaxed">
          {source.description}
        </span>
        {visibleDetails.length > 0 && (
          <span className="mt-3 grid gap-2">
            {visibleDetails.map(([detailLabel, value]) => (
              <span key={detailLabel} className="grid gap-0.5">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
                  {detailLabel}
                </span>
                <span className="break-words text-[11px] text-white/60">
                  {String(value)}
                </span>
              </span>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}
