/**
 * Gallery Embedding Explorer Page
 * Interactive 2D visualization of artwork embeddings
 */

import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData, Link } from '@remix-run/react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { apiClient } from '~/lib/api';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { EmbeddingScatterPlot } from '~/components/visualization/embedding-scatter-plot';
import { ArtworkDetailDialog } from '~/components/gallery/artwork-detail-dialog';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [
    { title: `${data?.gallery.name || 'Gallery'} - Embedding Explorer` },
    {
      name: 'description',
      content: 'Interactive visualization of artwork embeddings',
    },
  ];
};

export async function loader({ params }: LoaderFunctionArgs) {
  const { galleryId } = params;
  if (!galleryId) {
    throw new Response('Gallery ID is required', { status: 400 });
  }

  try {
    const gallery = await apiClient.getGallery(galleryId);
    return { gallery, galleryId };
  } catch (error) {
    throw new Response('Gallery not found', { status: 404 });
  }
}

export default function GalleryExplore() {
  const { gallery, galleryId } = useLoaderData<typeof loader>();
  const [colorBy, setColorBy] = useState<
    'artist' | 'year' | 'medium' | 'cluster' | null
  >('cluster');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArtwork, setSelectedArtwork] = useState<string | null>(null);
  const [filterArtist, setFilterArtist] = useState<string>('');
  const [filterMedium, setFilterMedium] = useState<string>('');

  // Fetch embeddings
  const {
    data: embeddingsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['embeddings', galleryId],
    queryFn: () => apiClient.getEmbeddings(galleryId, { limit: 500 }),
  });

  const embeddings = embeddingsData?.embeddings || [];
  const total = embeddingsData?.total || 0;

  // Filter artworks
  const filteredEmbeddings = embeddings.filter((artwork) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesTitle = artwork.title.toLowerCase().includes(query);
      const matchesArtist = artwork.artist?.toLowerCase().includes(query);
      if (!matchesTitle && !matchesArtist) return false;
    }

    // Artist filter
    if (filterArtist && artwork.artist !== filterArtist) {
      return false;
    }

    // Medium filter
    if (filterMedium && artwork.medium !== filterMedium) {
      return false;
    }

    return true;
  });

  // Get unique artists and mediums for filters
  const uniqueArtists = Array.from(
    new Set(embeddings.map((e) => e.artist).filter(Boolean))
  ).sort() as string[];

  const uniqueMediums = Array.from(
    new Set(embeddings.map((e) => e.medium).filter(Boolean))
  ).sort() as string[];

  // Get selected artwork details
  const selectedArtworkData = embeddings.find(
    (a) => a.id === selectedArtwork
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link
                to="/"
                className="text-2xl font-display font-bold bg-gradient-accent bg-clip-text text-transparent hover:opacity-80 transition-opacity"
              >
                Paillette
              </Link>
              <p className="text-sm text-neutral-400 mt-1">{gallery.name}</p>
            </div>
            <nav className="flex items-center gap-4">
              <Link
                to={`/galleries/${galleryId}`}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                Dashboard
              </Link>
              <Link
                to={`/galleries/${galleryId}/search`}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                Search
              </Link>
              <Link
                to={`/galleries/${galleryId}/explore`}
                className="text-white font-semibold"
              >
                Explore
              </Link>
              <Link
                to={`/galleries/${galleryId}/frame-removal`}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                Frame Removal
              </Link>
              <Link
                to="/translate"
                className="text-neutral-400 hover:text-white transition-colors"
              >
                Translate
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-4xl lg:text-5xl font-display font-bold mb-4">
            Embedding Explorer
          </h1>
          <p className="text-lg text-neutral-300 max-w-3xl">
            Explore artworks in 2D embedding space. Similar artworks cluster
            together based on visual features learned by AI.
          </p>
        </motion.div>

        {/* Filters and Controls */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8"
        >
          <Card>
            <CardHeader>
              <CardTitle>Filters & Settings</CardTitle>
              <CardDescription>
                Customize the visualization and filter artworks
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Search */}
                <div>
                  <Label htmlFor="search">Search</Label>
                  <Input
                    id="search"
                    placeholder="Title or artist..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="mt-1"
                  />
                </div>

                {/* Color by */}
                <div>
                  <Label htmlFor="colorBy">Color by</Label>
                  <select
                    id="colorBy"
                    value={colorBy || ''}
                    onChange={(e) =>
                      setColorBy(
                        (e.target.value as
                          | 'artist'
                          | 'year'
                          | 'medium'
                          | 'cluster') || null
                      )
                    }
                    className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white"
                  >
                    <option value="">None</option>
                    <option value="cluster">AI Clusters</option>
                    <option value="artist">Artist</option>
                    <option value="year">Period (50yr)</option>
                    <option value="medium">Medium</option>
                  </select>
                </div>

                {/* Filter by artist */}
                <div>
                  <Label htmlFor="filterArtist">Filter Artist</Label>
                  <select
                    id="filterArtist"
                    value={filterArtist}
                    onChange={(e) => setFilterArtist(e.target.value)}
                    className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white"
                  >
                    <option value="">All Artists</option>
                    {uniqueArtists.map((artist) => (
                      <option key={artist} value={artist}>
                        {artist}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Filter by medium */}
                <div>
                  <Label htmlFor="filterMedium">Filter Medium</Label>
                  <select
                    id="filterMedium"
                    value={filterMedium}
                    onChange={(e) => setFilterMedium(e.target.value)}
                    className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white"
                  >
                    <option value="">All Mediums</option>
                    {uniqueMediums.map((medium) => (
                      <option key={medium} value={medium}>
                        {medium}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Stats */}
              <div className="mt-4 flex items-center gap-6 text-sm text-neutral-400">
                <span>
                  Showing {filteredEmbeddings.length} of {total} artworks
                </span>
                {embeddingsData && (
                  <span>Dimensions: {embeddingsData.dimensions}D → 2D</span>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Visualization */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardContent className="p-6">
              {isLoading && (
                <div className="text-center py-32">
                  <div className="inline-block w-16 h-16 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-4" />
                  <p className="text-neutral-400">Loading embeddings...</p>
                </div>
              )}

              {error && (
                <div className="text-center py-32">
                  <div className="text-6xl mb-4">⚠️</div>
                  <p className="text-red-400">
                    {error instanceof Error
                      ? error.message
                      : 'Failed to load embeddings'}
                  </p>
                </div>
              )}

              {!isLoading && !error && filteredEmbeddings.length === 0 && (
                <div className="text-center py-32">
                  <div className="text-6xl mb-4">🎨</div>
                  <h3 className="text-xl font-semibold mb-2">
                    No embeddings found
                  </h3>
                  <p className="text-neutral-400 mb-6">
                    Upload artworks and wait for embeddings to be generated.
                  </p>
                  <Button asChild>
                    <Link to={`/galleries/${galleryId}/upload`}>
                      Upload Artworks
                    </Link>
                  </Button>
                </div>
              )}

              {!isLoading && !error && filteredEmbeddings.length > 0 && (
                <div className="flex justify-center">
                  <EmbeddingScatterPlot
                    artworks={filteredEmbeddings}
                    width={Math.min(1200, window.innerWidth - 200)}
                    height={700}
                    colorBy={colorBy}
                    selectedArtwork={selectedArtwork}
                    onArtworkClick={setSelectedArtwork}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Artwork detail dialog */}
      {selectedArtworkData && (
        <ArtworkDetailDialog
          artwork={{
            id: selectedArtworkData.id,
            title: selectedArtworkData.title,
            artist: selectedArtworkData.artist || undefined,
            year: selectedArtworkData.year || undefined,
            medium: selectedArtworkData.medium || undefined,
            imageUrl: selectedArtworkData.imageUrl,
            thumbnailUrl: selectedArtworkData.thumbnailUrl,
            galleryId: galleryId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }}
          open={!!selectedArtwork}
          onClose={() => setSelectedArtwork(null)}
        />
      )}
    </div>
  );
}
