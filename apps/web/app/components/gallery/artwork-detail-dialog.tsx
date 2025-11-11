import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Artwork } from '~/types';
import { formatDimensions, copyToClipboard } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';

interface ArtworkDetailDialogProps {
  artwork: Artwork;
  open: boolean;
  onClose: () => void;
}

export function ArtworkDetailDialog({
  artwork,
  open,
  onClose,
}: ArtworkDetailDialogProps) {
  const [copiedCitation, setCopiedCitation] = useState(false);
  const [copiedMetadata, setCopiedMetadata] = useState(false);

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
    <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl z-50 animate-slide-up">
          <div className="relative">
            {/* Close Button */}
            <Dialog.Close asChild>
              <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center transition-colors z-10">
                ✕
              </button>
            </Dialog.Close>

            {/* Image */}
            <div className="w-full bg-neutral-950 flex items-center justify-center p-8">
              <img
                src={artwork.imageUrl}
                alt={artwork.title || 'Artwork'}
                className="max-w-full max-h-[60vh] object-contain rounded-lg"
              />
            </div>

            {/* Content */}
            <div className="p-8 space-y-6">
              {/* Title */}
              <div>
                <Dialog.Title className="text-3xl font-display font-bold text-white mb-2">
                  {artwork.title || 'Untitled'}
                </Dialog.Title>
                {artwork.artist && (
                  <p className="text-xl text-neutral-300">{artwork.artist}</p>
                )}
              </div>

              {/* Basic Metadata */}
              <div className="grid grid-cols-2 gap-4 pb-6 border-b border-neutral-800">
                {artwork.year && (
                  <div>
                    <div className="text-sm text-neutral-500">Year</div>
                    <div className="text-white mt-1">{artwork.year}</div>
                  </div>
                )}
                {artwork.medium && (
                  <div>
                    <div className="text-sm text-neutral-500">Medium</div>
                    <div className="text-white mt-1">{artwork.medium}</div>
                  </div>
                )}
                {artwork.dimensions && (
                  <div>
                    <div className="text-sm text-neutral-500">Dimensions</div>
                    <div className="text-white mt-1">
                      {formatDimensions(artwork.dimensions)}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-sm text-neutral-500">Created</div>
                  <div className="text-white mt-1">
                    {new Date(artwork.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Description */}
              {artwork.description && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Description
                  </h3>
                  <p className="text-neutral-300 leading-relaxed">
                    {artwork.description}
                  </p>
                </div>
              )}

              {/* Additional Metadata */}
              {artwork.metadata && Object.keys(artwork.metadata).length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Additional Information
                  </h3>

                  {artwork.metadata.provenance && (
                    <div className="mb-4">
                      <div className="text-sm text-neutral-500 mb-1">Provenance</div>
                      <p className="text-neutral-300">{artwork.metadata.provenance}</p>
                    </div>
                  )}

                  {artwork.metadata.dominantColors &&
                    artwork.metadata.dominantColors.length > 0 && (
                      <div className="mb-4">
                        <div className="text-sm text-neutral-500 mb-2">
                          Dominant Colors
                        </div>
                        <div className="flex gap-2">
                          {artwork.metadata.dominantColors.map((color: string, i: number) => (
                            <div
                              key={i}
                              className="w-12 h-12 rounded-lg border border-neutral-700"
                              style={{ backgroundColor: color }}
                              title={color}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}

              {/* Citation */}
              <div className="bg-neutral-800/50 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Citation</h3>
                  {artwork.metadata?.citation?.format && (
                    <Badge variant="secondary" className="uppercase">
                      {artwork.metadata.citation.format}
                    </Badge>
                  )}
                </div>
                <p className="text-neutral-300 font-mono text-sm leading-relaxed">
                  {artwork.metadata?.citation?.text ||
                    generateBasicCitation(artwork)}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleCopyCitation}
                    className="flex-1"
                  >
                    {copiedCitation ? '✓ Copied!' : '📋 Copy Citation'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopyMetadata}
                    className="flex-1"
                  >
                    {copiedMetadata ? '✓ Copied!' : '📄 Copy All Metadata'}
                  </Button>
                </div>
              </div>

              {/* Artwork ID and URLs */}
              <div className="text-xs text-neutral-600 font-mono space-y-1">
                <div>ID: {artwork.id}</div>
                <div className="truncate">Gallery: {artwork.galleryId}</div>
              </div>
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
function generateBasicCitation(artwork: Artwork): string {
  const parts: string[] = [];

  if (artwork.artist) parts.push(artwork.artist);
  if (artwork.title) parts.push(`"${artwork.title}"`);
  if (artwork.year) parts.push(artwork.year.toString());
  if (artwork.medium) parts.push(artwork.medium);

  return parts.join(', ') + '.';
}

/**
 * Format all metadata for copying
 */
function formatMetadataForCopy(artwork: Artwork): string {
  const lines: string[] = [];

  lines.push('ARTWORK METADATA');
  lines.push('='.repeat(50));
  lines.push('');

  if (artwork.title) lines.push(`Title: ${artwork.title}`);
  if (artwork.artist) lines.push(`Artist: ${artwork.artist}`);
  if (artwork.year) lines.push(`Year: ${artwork.year}`);
  if (artwork.medium) lines.push(`Medium: ${artwork.medium}`);

  if (artwork.dimensions) {
    const dims = formatDimensions(artwork.dimensions);
    if (dims) lines.push(`Dimensions: ${dims}`);
  }

  lines.push('');

  if (artwork.description) {
    lines.push('Description:');
    lines.push(artwork.description);
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
  lines.push(`Artwork ID: ${artwork.id}`);
  lines.push(`Gallery ID: ${artwork.galleryId}`);
  lines.push(`Image URL: ${artwork.imageUrl}`);
  lines.push(`Created: ${new Date(artwork.createdAt).toLocaleString()}`);
  lines.push(`Updated: ${new Date(artwork.updatedAt).toLocaleString()}`);

  return lines.join('\n');
}
