/**
 * Gallery Frame Removal Page
 * Process and manage frame removal for artwork images
 */

import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData, Link } from '@remix-run/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { apiClient } from '~/lib/api';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Badge } from '~/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import type { Artwork, ProcessingStatus } from '~/types';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [
    { title: `${data?.gallery.name || 'Gallery'} - Frame Removal` },
    {
      name: 'description',
      content: 'Process and manage frame removal for artwork images',
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

export default function GalleryFrameRemoval() {
  const { gallery, galleryId } = useLoaderData<typeof loader>();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ProcessingStatus | 'all'>(
    'all'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArtwork, setSelectedArtwork] = useState<Artwork | null>(null);
  const [isProcessing, setIsProcessing] = useState<Set<string>>(new Set());

  // Fetch artworks
  const {
    data: artworksData,
    isLoading: artworksLoading,
  } = useQuery({
    queryKey: ['artworks', galleryId],
    queryFn: () => apiClient.listArtworks(galleryId, { limit: 100 }),
    refetchInterval: 5000, // Poll every 5 seconds to update processing status
  });

  // Fetch processing stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['processing-stats', galleryId],
    queryFn: () => apiClient.getProcessingStats(galleryId),
    refetchInterval: 5000,
  });

  const artworks = artworksData?.artworks || [];

  // Filter artworks
  const filteredArtworks = artworks.filter((artwork) => {
    // Status filter
    if (statusFilter !== 'all' && artwork.processingStatus !== statusFilter) {
      return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesTitle = artwork.title?.toLowerCase().includes(query);
      const matchesArtist = artwork.artist?.toLowerCase().includes(query);
      if (!matchesTitle && !matchesArtist) return false;
    }

    return true;
  });

  // Process single artwork mutation
  const processMutation = useMutation({
    mutationFn: (artworkId: string) => apiClient.processFrameRemoval(artworkId),
    onMutate: (artworkId) => {
      setIsProcessing((prev) => new Set(prev).add(artworkId));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artworks', galleryId] });
      queryClient.invalidateQueries({
        queryKey: ['processing-stats', galleryId],
      });
    },
    onSettled: (_, __, artworkId) => {
      setTimeout(() => {
        setIsProcessing((prev) => {
          const next = new Set(prev);
          next.delete(artworkId);
          return next;
        });
      }, 2000);
    },
  });

  // Batch process mutation
  const batchProcessMutation = useMutation({
    mutationFn: (options?: { artworkIds?: string[]; forceReprocess?: boolean }) =>
      apiClient.batchProcessFrames(galleryId, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artworks', galleryId] });
      queryClient.invalidateQueries({
        queryKey: ['processing-stats', galleryId],
      });
    },
  });

  const handleProcessArtwork = (artworkId: string) => {
    processMutation.mutate(artworkId);
  };

  const handleBatchProcess = () => {
    batchProcessMutation.mutate({ forceReprocess: false });
  };

  const handleBatchReprocess = () => {
    batchProcessMutation.mutate({ forceReprocess: true });
  };

  const getStatusBadge = (status?: ProcessingStatus) => {
    switch (status) {
      case 'pending':
        return <Badge variant="warning">Pending</Badge>;
      case 'processing':
        return (
          <Badge className="bg-blue-500/20 text-blue-300 border border-blue-500/50">
            Processing
          </Badge>
        );
      case 'completed':
        return <Badge variant="success">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="secondary">Not Started</Badge>;
    }
  };

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
                className="text-neutral-400 hover:text-white transition-colors"
              >
                Explore
              </Link>
              <Link
                to={`/galleries/${galleryId}/frame-removal`}
                className="text-white font-semibold"
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
            Frame Removal
          </h1>
          <p className="text-lg text-neutral-300 max-w-3xl">
            Automatically detect and remove frames from artwork images using AI
            edge detection. Process individual artworks or batch process your
            entire collection.
          </p>
        </motion.div>

        {/* Stats Dashboard */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8"
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Total Artworks</CardDescription>
                <CardTitle className="text-3xl">
                  {statsLoading ? '...' : stats?.total || 0}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Processed</CardDescription>
                <CardTitle className="text-3xl text-green-400">
                  {statsLoading ? '...' : stats?.completed || 0}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Processing</CardDescription>
                <CardTitle className="text-3xl text-blue-400">
                  {statsLoading
                    ? '...'
                    : (stats?.pending || 0) + (stats?.processing || 0)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Avg Confidence</CardDescription>
                <CardTitle className="text-3xl">
                  {statsLoading
                    ? '...'
                    : stats?.avgConfidence
                      ? `${(stats.avgConfidence * 100).toFixed(0)}%`
                      : 'N/A'}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
        </motion.div>

        {/* Batch Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-8"
        >
          <Card>
            <CardHeader>
              <CardTitle>Batch Actions</CardTitle>
              <CardDescription>
                Process multiple artworks at once
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-4">
              <Button
                onClick={handleBatchProcess}
                disabled={batchProcessMutation.isPending}
              >
                {batchProcessMutation.isPending
                  ? 'Processing...'
                  : 'Process All Pending'}
              </Button>
              <Button
                variant="outline"
                onClick={handleBatchReprocess}
                disabled={batchProcessMutation.isPending}
              >
                Reprocess All
              </Button>
              {batchProcessMutation.isSuccess && (
                <div className="flex items-center text-green-400 text-sm">
                  Queued {batchProcessMutation.data.totalQueued} artworks for
                  processing
                </div>
              )}
              {batchProcessMutation.isError && (
                <div className="flex items-center text-red-400 text-sm">
                  Error: {batchProcessMutation.error.message}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-8"
        >
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>Filter artworks by status or search</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                {/* Status filter */}
                <div>
                  <Label htmlFor="statusFilter">Status</Label>
                  <select
                    id="statusFilter"
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as ProcessingStatus | 'all')
                    }
                    className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white"
                  >
                    <option value="all">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
              </div>

              {/* Stats */}
              <div className="mt-4 text-sm text-neutral-400">
                Showing {filteredArtworks.length} of {artworks.length} artworks
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Artworks Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {artworksLoading && (
            <div className="text-center py-12">
              <div className="inline-block w-16 h-16 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-4" />
              <p className="text-neutral-400">Loading artworks...</p>
            </div>
          )}

          {!artworksLoading && filteredArtworks.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center">
                <div className="text-6xl mb-4">🖼️</div>
                <h3 className="text-xl font-semibold mb-2">No artworks found</h3>
                <p className="text-neutral-400">
                  {searchQuery || statusFilter !== 'all'
                    ? 'Try adjusting your filters'
                    : 'Upload artworks to get started'}
                </p>
              </CardContent>
            </Card>
          )}

          {!artworksLoading && filteredArtworks.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredArtworks.map((artwork) => (
                <Card
                  key={artwork.id}
                  className="overflow-hidden hover:border-primary-500/50 transition-colors"
                >
                  <div className="relative aspect-square">
                    <img
                      src={artwork.imageUrlProcessed || artwork.thumbnailUrl || artwork.imageUrl}
                      alt={artwork.title || 'Artwork'}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-2 right-2">
                      {getStatusBadge(artwork.processingStatus)}
                    </div>
                    {artwork.frameRemovalConfidence && (
                      <div className="absolute bottom-2 right-2">
                        <Badge className="bg-black/70 text-white border-white/20">
                          {(artwork.frameRemovalConfidence * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    )}
                  </div>
                  <CardContent className="p-4">
                    <h3 className="font-semibold mb-1 truncate">
                      {artwork.title || 'Untitled'}
                    </h3>
                    {artwork.artist && (
                      <p className="text-sm text-neutral-400 mb-3 truncate">
                        {artwork.artist}
                      </p>
                    )}

                    {artwork.processingError && (
                      <p className="text-xs text-red-400 mb-3">
                        {artwork.processingError}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() =>
                          setSelectedArtwork(
                            selectedArtwork?.id === artwork.id ? null : artwork
                          )
                        }
                        disabled={
                          !artwork.imageUrlProcessed ||
                          artwork.processingStatus !== 'completed'
                        }
                      >
                        {selectedArtwork?.id === artwork.id
                          ? 'Hide Compare'
                          : 'Compare'}
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleProcessArtwork(artwork.id)}
                        disabled={
                          isProcessing.has(artwork.id) ||
                          artwork.processingStatus === 'processing' ||
                          processMutation.isPending
                        }
                      >
                        {isProcessing.has(artwork.id) ||
                        artwork.processingStatus === 'processing'
                          ? 'Processing...'
                          : artwork.processingStatus === 'completed'
                            ? 'Reprocess'
                            : 'Process'}
                      </Button>
                    </div>

                    {/* Before/After Comparison */}
                    {selectedArtwork?.id === artwork.id &&
                      artwork.imageUrlProcessed && (
                        <div className="mt-4 pt-4 border-t border-neutral-700">
                          <h4 className="text-sm font-semibold mb-2">
                            Before & After
                          </h4>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <p className="text-xs text-neutral-400 mb-1">
                                Original
                              </p>
                              <img
                                src={artwork.imageUrl}
                                alt="Original"
                                className="w-full aspect-square object-cover rounded border border-neutral-700"
                              />
                            </div>
                            <div>
                              <p className="text-xs text-neutral-400 mb-1">
                                Processed
                              </p>
                              <img
                                src={artwork.imageUrlProcessed}
                                alt="Processed"
                                className="w-full aspect-square object-cover rounded border border-neutral-700"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
