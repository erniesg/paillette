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

const toneClasses: Record<SourceTone, string> = {
  institution: 'border-cyan-200/15 bg-cyan-200/[0.06] text-cyan-100',
  roots: 'border-amber-200/15 bg-amber-200/[0.06] text-amber-200',
  metadata: 'border-cyan-200/15 bg-cyan-200/[0.06] text-cyan-100',
  ai: 'border-primary-300/15 bg-primary-300/[0.06] text-primary-300',
};

const cleanSourceLabel = (label: string) =>
  label.replace(/^from\s+/i, '').trim();

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
        'Machine-generated visual caption; not source catalogue text.',
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
}: {
  label: string;
  compact?: boolean;
  showLabel?: boolean;
  className?: string;
}) {
  const details = getSourceIndicatorDetails(label);
  const Icon = details.icon;
  const tooltip = `${details.title}: ${details.description}`;

  return (
    <span
      className={cn(
        'group relative inline-flex shrink-0 items-center gap-1.5 rounded-full border font-mono uppercase leading-none tracking-[0.12em] shadow-sm',
        compact ? 'px-1.5 py-1 text-[8px]' : 'px-2 py-1 text-[9px]',
        toneClasses[details.tone],
        className
      )}
      aria-label={`Source: ${tooltip}`}
      data-source-description={tooltip}
    >
      <Icon
        aria-hidden="true"
        className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'}
      />
      <span>{showLabel ? details.title : details.shortLabel}</span>
    </span>
  );
}
