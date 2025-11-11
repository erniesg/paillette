import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Artwork } from '~/types';
import { ArtworkDetailDialog } from './artwork-detail-dialog';

interface ArtworkGridProps {
  artworks: Artwork[];
}

export function ArtworkGrid({ artworks }: ArtworkGridProps) {
  const [selectedArtwork, setSelectedArtwork] = useState<Artwork | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {artworks.map((artwork, index) => (
          <motion.div
            key={artwork.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="group relative bg-neutral-900/80 border border-neutral-800 rounded-xl overflow-hidden hover:border-primary-500/50 transition-all duration-300 hover:shadow-xl hover:shadow-primary-500/10 cursor-pointer"
            onClick={() => setSelectedArtwork(artwork)}
          >
            {/* Image */}
            <div className="aspect-square bg-neutral-950 flex items-center justify-center overflow-hidden">
              <img
                src={artwork.thumbnailUrl || artwork.imageUrl}
                alt={artwork.title || 'Artwork'}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            </div>

            {/* Info */}
            <div className="p-4">
              <h3 className="font-semibold text-white truncate group-hover:text-primary-400 transition-colors">
                {artwork.title || 'Untitled'}
              </h3>
              {artwork.artist && (
                <p className="text-sm text-neutral-400 truncate mt-1">
                  {artwork.artist}
                </p>
              )}
              <div className="flex items-center justify-between mt-3 text-xs text-neutral-500">
                <span>{artwork.year || '—'}</span>
                {artwork.metadata?.medium && (
                  <span className="truncate ml-2">{artwork.metadata.medium}</span>
                )}
              </div>
            </div>

            {/* Hover Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-neutral-900 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          </motion.div>
        ))}
      </div>

      {/* Artwork Detail Dialog */}
      {selectedArtwork && (
        <ArtworkDetailDialog
          artwork={selectedArtwork}
          open={!!selectedArtwork}
          onClose={() => setSelectedArtwork(null)}
        />
      )}
    </>
  );
}
