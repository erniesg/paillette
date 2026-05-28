import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, FileText, X } from 'lucide-react';
import type { ArtworkSearchResult } from '~/types';
import {
  formatSimilarity,
  formatDimensions,
  copyToClipboard,
} from '~/lib/utils';
import {
  getGeneratedCaptionText,
  getPublicDescriptionDetails,
} from '~/lib/public-artwork-metadata';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { SourceIndicator } from '~/components/artwork/source-indicator';

interface ArtworkDialogProps {
  artwork: ArtworkSearchResult;
  open: boolean;
  onClose: () => void;
}

export function ArtworkDialog({ artwork, open, onClose }: ArtworkDialogProps) {
  const [copiedCitation, setCopiedCitation] = useState(false);
  const [copiedMetadata, setCopiedMetadata] = useState(false);
  const descriptionDetails = getPublicDescriptionDetails(artwork);
  const generatedCaption = getGeneratedCaptionText(artwork);

  const handleCopyCitation = async () => {
    const citation =
      artwork.metadata?.citation?.text || generateBasicCitation(artwork);
    const success = await copyToClipboard(citation);
    if (success) {
      setCopiedCitation(true);
      setTimeout(() => setCopiedCitation(false), 2000);
    }
  };

  const handleCopyMetadata = async () => {
    const metadata = formatMetadataForCopy(artwork);
    const success = await copyToClipboard(metadata);
    if (success) {
      setCopiedMetadata(true);
      setTimeout(() => setCopiedMetadata(false), 2000);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/80 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[92dvh] w-[calc(100vw-1rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 grid-rows-[minmax(180px,34dvh)_minmax(0,1fr)] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl outline-none animate-slide-up xl:h-[min(86dvh,760px)] xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] xl:grid-rows-none">
          <Dialog.Description className="sr-only">
            Source-labelled catalogue text, generated captions, citation, and
            metadata for the selected artwork.
          </Dialog.Description>
          <div className="relative flex min-h-0 min-w-0 items-center justify-center bg-neutral-950 p-4 md:p-6">
            <Dialog.Close asChild>
              <button className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-neutral-900/90 text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                <span className="sr-only">Close artwork details</span>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
            {artwork.imageUrl ? (
              <img
                src={artwork.imageUrl}
                alt={artwork.title || 'Artwork'}
                className="max-h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full min-h-64 w-full items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 text-sm text-neutral-500">
                No image
              </div>
            )}
          </div>

          <div className="min-h-0 space-y-6 overflow-y-auto p-5 md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-neutral-500">
                  Artwork
                </p>
                <Dialog.Title className="mt-2 font-display text-2xl font-bold leading-tight text-white md:text-3xl">
                  {artwork.title || 'Untitled'}
                </Dialog.Title>
                {artwork.artist && (
                  <p className="mt-2 text-lg leading-snug text-neutral-300">
                    {artwork.artist}
                  </p>
                )}
              </div>
              <Badge variant="success" className="shrink-0 px-3 py-1.5 text-sm">
                {formatSimilarity(artwork.similarity)} match
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-4 border-y border-neutral-800 py-5 sm:grid-cols-2">
              {artwork.year && (
                <div>
                  <div className="text-sm text-neutral-500">Year</div>
                  <div className="mt-1 text-white">{artwork.year}</div>
                </div>
              )}
              {artwork.metadata?.medium && (
                <div>
                  <div className="text-sm text-neutral-500">Medium</div>
                  <div className="mt-1 text-white">
                    {artwork.metadata.medium}
                  </div>
                </div>
              )}
              {artwork.metadata?.dimensions && (
                <div>
                  <div className="text-sm text-neutral-500">Dimensions</div>
                  <div className="mt-1 text-white">
                    {formatDimensions(artwork.metadata.dimensions)}
                  </div>
                </div>
              )}
            </div>

            {descriptionDetails && (
              <section>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-white">
                    Catalogue text
                  </h3>
                  <SourceIndicator
                    label={descriptionDetails.sourceLabel}
                    showLabel
                  />
                </div>
                <p className="mt-2 leading-relaxed text-neutral-300">
                  {descriptionDetails.text}
                </p>
              </section>
            )}

            {generatedCaption && (
              <section className="rounded-md border border-primary-300/10 bg-primary-300/[0.04] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary-200/70">
                    Generated visual caption
                  </h3>
                  <SourceIndicator
                    label="Generated by Paillette AI"
                    showLabel
                  />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-neutral-200">
                  {generatedCaption}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                  Machine-generated from the image; not catalogue text from NGS
                  or Roots.
                </p>
              </section>
            )}

            {artwork.metadata?.provenance && (
              <section>
                <h3 className="mb-2 text-lg font-semibold text-white">
                  Provenance
                </h3>
                <p className="leading-relaxed text-neutral-300">
                  {artwork.metadata.provenance}
                </p>
              </section>
            )}

            {artwork.metadata?.dominantColors &&
              artwork.metadata.dominantColors.length > 0 && (
                <section>
                  <h3 className="mb-3 text-lg font-semibold text-white">
                    Dominant colors
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {artwork.metadata.dominantColors.map((color, i) => (
                      <div
                        key={`${color}-${i}`}
                        className="h-11 w-11 rounded-md border border-neutral-700"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </section>
              )}

            <section className="space-y-4 rounded-md bg-neutral-800/50 p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-white">Citation</h3>
                {artwork.metadata?.citation?.format && (
                  <Badge variant="secondary" className="uppercase">
                    {artwork.metadata.citation.format}
                  </Badge>
                )}
              </div>
              <p className="font-mono text-sm leading-relaxed text-neutral-300">
                {artwork.metadata?.citation?.text ||
                  generateBasicCitation(artwork)}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  size="sm"
                  onClick={handleCopyCitation}
                  className="flex-1"
                >
                  {copiedCitation ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copiedCitation ? 'Copied' : 'Copy citation'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyMetadata}
                  className="flex-1"
                >
                  {copiedMetadata ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                  {copiedMetadata ? 'Copied' : 'Copy metadata'}
                </Button>
              </div>
            </section>

            {artwork.metadata?.translations &&
              Object.keys(artwork.metadata.translations).length > 0 && (
                <section>
                  <h3 className="mb-3 text-lg font-semibold text-white">
                    Translations
                  </h3>
                  <div className="space-y-3">
                    {Object.entries(artwork.metadata.translations).map(
                      ([lang, translation]) => (
                        <details
                          key={lang}
                          className="rounded-md bg-neutral-800/30 p-4"
                        >
                          <summary className="cursor-pointer font-medium text-primary-400 hover:text-primary-300">
                            {lang.toUpperCase()}
                          </summary>
                          <div className="mt-3 space-y-2 text-sm">
                            {translation.title && (
                              <div>
                                <span className="text-neutral-500">
                                  Title:{' '}
                                </span>
                                <span className="text-neutral-300">
                                  {translation.title}
                                </span>
                              </div>
                            )}
                            {translation.description && (
                              <div>
                                <span className="text-neutral-500">
                                  Description:{' '}
                                </span>
                                <span className="text-neutral-300">
                                  {translation.description}
                                </span>
                              </div>
                            )}
                          </div>
                        </details>
                      )
                    )}
                  </div>
                </section>
              )}

            <div className="font-mono text-xs text-neutral-600">
              ID: {artwork.id}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Generate a basic citation if none exists in metadata
 */
function generateBasicCitation(artwork: ArtworkSearchResult): string {
  const parts: string[] = [];

  if (artwork.artist) parts.push(artwork.artist);
  if (artwork.title) parts.push(`"${artwork.title}"`);
  if (artwork.year) parts.push(artwork.year.toString());
  if (artwork.metadata?.medium) parts.push(artwork.metadata.medium);

  return parts.join(', ') + '.';
}

/**
 * Format all metadata for copying
 */
function formatMetadataForCopy(artwork: ArtworkSearchResult): string {
  const lines: string[] = [];
  const descriptionDetails = getPublicDescriptionDetails(artwork);
  const generatedCaption = getGeneratedCaptionText(artwork);

  lines.push('ARTWORK METADATA');
  lines.push('='.repeat(50));
  lines.push('');

  if (artwork.title) lines.push(`Title: ${artwork.title}`);
  if (artwork.artist) lines.push(`Artist: ${artwork.artist}`);
  if (artwork.year) lines.push(`Year: ${artwork.year}`);
  if (artwork.metadata?.medium)
    lines.push(`Medium: ${artwork.metadata.medium}`);

  if (artwork.metadata?.dimensions) {
    const dims = formatDimensions(artwork.metadata.dimensions);
    if (dims) lines.push(`Dimensions: ${dims}`);
  }

  lines.push('');

  if (descriptionDetails) {
    lines.push(`Catalogue text (${descriptionDetails.sourceLabel}):`);
    lines.push(descriptionDetails.text);
    lines.push('');
  }

  if (generatedCaption) {
    lines.push('Generated visual caption (Paillette AI):');
    lines.push(generatedCaption);
    lines.push('Machine-generated from the image; not catalogue text.');
    lines.push('');
  }

  if (artwork.metadata?.provenance) {
    lines.push('Provenance:');
    lines.push(artwork.metadata.provenance);
    lines.push('');
  }

  if (artwork.metadata?.citation?.text) {
    lines.push('Citation:');
    lines.push(artwork.metadata.citation.text);
    lines.push('');
  }

  lines.push('='.repeat(50));
  lines.push(`Similarity Score: ${formatSimilarity(artwork.similarity)}`);
  lines.push(`Artwork ID: ${artwork.id}`);
  lines.push(`Image URL: ${artwork.imageUrl}`);

  return lines.join('\n');
}
