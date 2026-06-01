import { useMemo, useState } from 'react';
import { Check, Copy, Quote } from 'lucide-react';
import { getPublicCitationParts } from '~/lib/public-artwork-metadata';
import { cn, copyRichTextToClipboard } from '~/lib/utils';

export function CitationPanel({
  artwork,
  className,
  onCopyCitation,
}: {
  artwork: Record<string, any>;
  className?: string;
  onCopyCitation?: (metadata: Record<string, unknown>) => void;
}) {
  const [copied, setCopied] = useState(false);
  const citation = useMemo(() => getPublicCitationParts(artwork), [artwork]);

  const handleCopy = async () => {
    const ok = await copyRichTextToClipboard({
      text: citation.plainText,
      html: citation.htmlText,
    });
    if (!ok) return;

    setCopied(true);
    onCopyCitation?.({
      style: 'chicago',
      plainTextLength: citation.plainText.length,
      htmlTextLength: citation.htmlText.length,
    });
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section
      className={cn(
        'rounded-md border border-white/[0.08] bg-white/[0.025] p-4',
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Quote className="h-3.5 w-3.5 text-white/35" />
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
            Cite this work
          </h3>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
          Chicago
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-2 rounded-md border border-white/[0.08] bg-black/20 p-3 sm:flex-row sm:items-start">
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-white/72">
          {citation.artist}. <cite className="italic">{citation.title}</cite>.{' '}
          {citation.date}
          {citation.physical ? `. ${citation.physical}` : ''}
          {citation.institution ? `. ${citation.institution}` : ''}.
        </p>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.055] px-3 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.09] hover:text-white"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </section>
  );
}
