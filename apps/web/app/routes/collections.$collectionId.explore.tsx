/**
 * Collection Embedding Explorer Page
 * Interactive 2D visualization of artwork embeddings
 */

import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData, Link } from '@remix-run/react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
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
import { Logo } from '~/components/ui/logo';
import { UserMenu } from '~/components/user/user-menu';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [
    { title: `${data?.collection.name || 'Collection'} - Embedding Explorer` },
    {
      name: 'description',
      content: 'Interactive visualization of image embeddings',
    },
  ];
};

export async function loader({ params }: LoaderFunctionArgs) {
  const { collectionId } = params;
  if (!collectionId) {
    throw new Response('Collection ID is required', { status: 400 });
  }

  try {
    // Fetch collection data from API
    const apiBase = 'https://paillette-stg.workers.dev';
    const response = await fetch(`${apiBase}/api/v1/galleries/${collectionId}`);
    const data = await response.json() as { success: boolean; data?: { id: string; name: string; description?: string }; error?: { message: string } };

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Collection not found');
    }

    return { collection: data.data, collectionId };
  } catch (error) {
    throw new Response('Collection not found', { status: 404 });
  }
}

export default function CollectionExplore() {
  const { collection, collectionId } = useLoaderData<typeof loader>();
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
    queryKey: ['embeddings', collectionId],
    queryFn: async () => {
      const apiBase = typeof window !== 'undefined' && window.location.origin.includes('localhost')
        ? 'http://localhost:8787'
        : 'https://paillette-stg.workers.dev';

      const response = await fetch(`${apiBase}/api/v1/galleries/${collectionId}/embeddings?limit=500`);
      const data = await response.json() as {
        success: boolean;
        data?: {
          embeddings: Array<{
            id: string;
            title: string;
            artist: string | null;
            year: number | null;
            medium: string | null;
            imageUrl: string;
            thumbnailUrl: string;
            embedding: number[];
          }>;
          total: number;
          dimensions: number;
        };
        error?: { message: string };
      };

      if (!data.success || !data.data) {
        throw new Error(data.error?.message || 'Failed to fetch embeddings');
      }
      return data.data;
    },
  });

  const embeddings = embeddingsData?.embeddings || [];
  const total = embeddingsData?.total || 0;

  // Filter artworks
  const filteredEmbeddings = embeddings.filter((artwork: { title: string; artist?: string | null; medium?: string | null }) => {
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
    new Set(embeddings.map((e: { artist?: string | null }) => e.artist).filter(Boolean))
  ).sort() as string[];

  const uniqueMediums = Array.from(
    new Set(embeddings.map((e: { medium?: string | null }) => e.medium).filter(Boolean))
  ).sort() as string[];

  // Get selected artwork details
  const selectedArtworkData = embeddings.find(
    (a: { id: string }) => a.id === selectedArtwork
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to={`/collections/${collectionId}`}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <Logo linkToHome />
                <p className="text-sm text-neutral-400 mt-1">{collection.name}</p>
              </div>
            </div>
            <nav className="flex items-center gap-4">
              <Link
                to={`/collections/${collectionId}`}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                Dashboard
              </Link>
              <Link
                to={`/collections/${collectionId}/search`}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                Search
              </Link>
              <Link
                to={`/collections/${collectionId}/explore`}
                className="text-white font-semibold"
              >
                Explore
              </Link>
              <div className="ml-2 pl-4 border-l border-neutral-700">
                <UserMenu />
              </div>
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
          <h1 className="text-4xl lg:text-5xl font-display font-bold mb-4 flex items-center gap-3">
            <Sparkles className="h-10 w-10 text-primary-400" />
            Embedding Explorer
          </h1>
          <p className="text-lg text-neutral-300 max-w-3xl">
            Explore images in 2D embedding space. Similar images cluster
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
                Customize the visualization and filter images
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
                  Showing {filteredEmbeddings.length} of {total} images
                </span>
                {embeddingsData && (
                  <span>Dimensions: {embeddingsData.dimensions}D reduced to 2D</span>
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
                  <div className="text-6xl mb-4">Warning</div>
                  <p className="text-red-400">
                    {error instanceof Error
                      ? error.message
                      : 'Failed to load embeddings'}
                  </p>
                </div>
              )}

              {!isLoading && !error && filteredEmbeddings.length === 0 && (
                <div className="text-center py-32">
                  <Sparkles className="h-16 w-16 mx-auto mb-4 text-neutral-600" />
                  <h3 className="text-xl font-semibold mb-2">
                    No embeddings found
                  </h3>
                  <p className="text-neutral-400 mb-6">
                    Upload images and wait for embeddings to be generated.
                  </p>
                  <Button asChild>
                    <Link to={`/collections/${collectionId}/upload`}>
                      Upload Images
                    </Link>
                  </Button>
                </div>
              )}

              {!isLoading && !error && filteredEmbeddings.length > 0 && (
                <div className="flex justify-center">
                  <EmbeddingScatterPlot
                    artworks={filteredEmbeddings}
                    width={Math.min(1200, typeof window !== 'undefined' ? window.innerWidth - 200 : 1000)}
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
            galleryId: collectionId,
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
