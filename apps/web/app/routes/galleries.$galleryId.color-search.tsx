import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData, Link } from '@remix-run/react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { apiClient } from '~/lib/api';
import { ColorPicker } from '~/components/ui/color-picker';
import { SearchResults } from '~/components/search/search-results';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Card, CardContent } from '~/components/ui/card';
import { Input } from '~/components/ui/input';

export const meta: MetaFunction = () => {
  return [
    { title: 'Color Search - Paillette' },
    {
      name: 'description',
      content: 'Find artworks by color palette and visual aesthetics',
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

export default function ColorSearchPage() {
  const { gallery, galleryId } = useLoaderData<typeof loader>();

  // Search state
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [matchMode, setMatchMode] = useState<'any' | 'all'>('any');
  const [threshold, setThreshold] = useState(15);
  const [limit, setLimit] = useState(20);
  const [shouldSearch, setShouldSearch] = useState(false);

  // Color search query
  const colorSearchQuery = useQuery({
    queryKey: ['search', 'color', galleryId, selectedColors, matchMode, threshold, limit],
    queryFn: async () => {
      if (selectedColors.length === 0) return null;
      return apiClient.searchColor(galleryId, {
        colors: selectedColors,
        matchMode,
        threshold,
        limit,
      });
    },
    enabled: shouldSearch && selectedColors.length > 0,
  });

  const results = colorSearchQuery.data?.results || [];
  const isLoading = colorSearchQuery.isLoading;
  const error = colorSearchQuery.error;

  // Handle search
  const handleSearch = () => {
    if (selectedColors.length > 0) {
      setShouldSearch(true);
    }
  };

  // Reset search
  const handleReset = () => {
    setSelectedColors([]);
    setShouldSearch(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <a
                href={`/galleries/${galleryId}`}
                className="text-2xl font-display font-bold bg-gradient-accent bg-clip-text text-transparent hover:opacity-80 transition-opacity"
              >
                Paillette
              </a>
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
                to={`/galleries/${galleryId}/color-search`}
                className="text-white font-semibold"
              >
                Color Search
              </Link>
              <Link
                to={`/galleries/${galleryId}/explore`}
                className="text-neutral-400 hover:text-white transition-colors"
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
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl font-display font-bold bg-gradient-accent bg-clip-text text-transparent mb-4">
            Search by Color
          </h1>
          <p className="text-neutral-400 max-w-2xl mx-auto">
            Find artworks that match specific color palettes. Select up to 5 colors
            to discover artworks with similar visual aesthetics.
          </p>
        </motion.div>

        {/* Color Search Interface */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="max-w-4xl mx-auto mb-12"
        >
          <ColorPicker
            value={selectedColors}
            onChange={setSelectedColors}
            maxColors={5}
          />

          {/* Search Options */}
          <Card className="mt-6">
            <CardContent className="p-6 space-y-4">
              {/* Match Mode */}
              <div>
                <Label className="text-sm font-semibold mb-2 block">
                  Match Mode
                </Label>
                <div className="flex gap-2">
                  <Button
                    variant={matchMode === 'any' ? 'default' : 'outline'}
                    onClick={() => setMatchMode('any')}
                    className="flex-1"
                  >
                    Match ANY Color
                  </Button>
                  <Button
                    variant={matchMode === 'all' ? 'default' : 'outline'}
                    onClick={() => setMatchMode('all')}
                    className="flex-1"
                  >
                    Match ALL Colors
                  </Button>
                </div>
                <p className="text-xs text-neutral-500 mt-2">
                  {matchMode === 'any'
                    ? 'Find artworks containing at least one of the selected colors'
                    : 'Find artworks containing all of the selected colors'}
                </p>
              </div>

              {/* Advanced Options */}
              <details>
                <summary className="cursor-pointer text-sm text-neutral-400 hover:text-white">
                  Advanced Options
                </summary>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <Label htmlFor="threshold">Color Similarity Threshold</Label>
                    <Input
                      id="threshold"
                      type="number"
                      min={5}
                      max={50}
                      step={5}
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="mt-2"
                    />
                    <p className="text-xs text-neutral-500 mt-1">
                      Lower = stricter match (default: 15)
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="limit">Results Limit</Label>
                    <Input
                      id="limit"
                      type="number"
                      min={1}
                      max={100}
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                      className="mt-2"
                    />
                    <p className="text-xs text-neutral-500 mt-1">
                      Max artworks to return (default: 20)
                    </p>
                  </div>
                </div>
              </details>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-4">
                <Button
                  onClick={handleSearch}
                  disabled={selectedColors.length === 0}
                  className="flex-1"
                >
                  🎨 Search Artworks
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={selectedColors.length === 0}
                >
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Search Results */}
        <AnimatePresence mode="wait">
          {/* Loading State */}
          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-12"
            >
              <div className="inline-block w-16 h-16 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-4" />
              <p className="text-neutral-400">Searching by color...</p>
            </motion.div>
          )}

          {/* Error State */}
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-12"
            >
              <div className="text-6xl mb-4">⚠️</div>
              <p className="text-red-400">
                {error instanceof Error ? error.message : 'Search failed'}
              </p>
            </motion.div>
          )}

          {/* Results */}
          {!isLoading && !error && results.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <div className="mb-4 text-center">
                <p className="text-neutral-400">
                  Found {results.length} artwork{results.length !== 1 ? 's' : ''}{' '}
                  matching your color selection
                  {colorSearchQuery.data?.took && (
                    <span className="text-neutral-500">
                      {' '}
                      ({Math.round(colorSearchQuery.data.took)}ms)
                    </span>
                  )}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {results.map((result) => (
                  <motion.div
                    key={result.artworkId}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="group"
                  >
                    <Card className="overflow-hidden hover:border-primary-500 transition-colors duration-300">
                      <div className="aspect-square relative overflow-hidden bg-neutral-900">
                        <img
                          src={result.imageUrl}
                          alt={result.title}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                        />
                      </div>
                      <CardContent className="p-4">
                        <h3 className="font-semibold text-white mb-2 truncate">
                          {result.title}
                        </h3>
                        {/* Color Palette */}
                        <div className="flex gap-1 mb-2">
                          {result.dominantColors.slice(0, 5).map((colorItem, idx) => (
                            <div
                              key={idx}
                              className="flex-1 h-6 rounded border border-neutral-700"
                              style={{ backgroundColor: colorItem.color }}
                              title={`${colorItem.color} (${colorItem.percentage.toFixed(1)}%)`}
                            />
                          ))}
                        </div>
                        {/* Matched Colors */}
                        <div className="flex flex-wrap gap-1">
                          {result.matchedColors.map((match, idx) => (
                            <div
                              key={idx}
                              className="text-xs px-2 py-1 rounded bg-primary-500/20 text-primary-300 border border-primary-500/50"
                            >
                              {match.searchColor}
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-neutral-500 mt-2">
                          Similarity: {((1 - result.averageDistance / 100) * 100).toFixed(0)}%
                        </p>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* No Results */}
          {!isLoading && !error && shouldSearch && results.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-12"
            >
              <div className="text-6xl mb-4">🎨</div>
              <p className="text-neutral-400">No artworks found with these colors</p>
              <p className="text-sm text-neutral-500 mt-2">
                Try selecting different colors or increasing the similarity threshold
              </p>
            </motion.div>
          )}

          {/* Initial State */}
          {!isLoading && !error && !shouldSearch && selectedColors.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-12"
            >
              <div className="text-6xl mb-4">👆</div>
              <p className="text-neutral-400">
                Click &quot;Search Artworks&quot; to find matching colors
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
