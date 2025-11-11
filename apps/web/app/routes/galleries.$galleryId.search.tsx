import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData, useSearchParams, Link } from '@remix-run/react';
import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import { apiClient } from '~/lib/api';
import { debounce } from '~/lib/utils';
import { SearchResults } from '~/components/search/search-results';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Card, CardContent } from '~/components/ui/card';

export const meta: MetaFunction = () => {
  return [
    { title: 'Search Artworks - Paillette' },
    {
      name: 'description',
      content: 'Search and discover artworks using AI-powered multimodal search',
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

export default function SearchPage() {
  const { gallery, galleryId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search state
  const [searchMode, setSearchMode] = useState<'text' | 'image'>('text');
  const [textQuery, setTextQuery] = useState(
    searchParams.get('q') || ''
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [topK, setTopK] = useState(10);
  const [minScore, setMinScore] = useState(0.7);
  const [shouldSearch, setShouldSearch] = useState(false);

  // Text search query
  const textSearchQuery = useQuery({
    queryKey: ['search', 'text', galleryId, textQuery, topK, minScore],
    queryFn: async () => {
      if (!textQuery.trim()) return null;
      return apiClient.searchText(galleryId, {
        query: textQuery,
        topK,
        minScore,
      });
    },
    enabled: searchMode === 'text' && shouldSearch && textQuery.trim().length > 0,
  });

  // Image search query
  const imageSearchQuery = useQuery({
    queryKey: ['search', 'image', galleryId, imageFile?.name, topK, minScore],
    queryFn: async () => {
      if (!imageFile) return null;
      return apiClient.searchImage(galleryId, {
        image: imageFile,
        topK,
        minScore,
      });
    },
    enabled: searchMode === 'image' && shouldSearch && imageFile !== null,
  });

  // Get current results based on mode
  const currentQuery = searchMode === 'text' ? textSearchQuery : imageSearchQuery;
  const results = currentQuery.data?.results || [];
  const isLoading = currentQuery.isLoading;
  const error = currentQuery.error;

  // Debounced text search
  const debouncedSearch = useCallback(
    debounce(() => {
      if (textQuery.trim()) {
        setShouldSearch(true);
      }
    }, 500),
    [textQuery]
  );

  // Trigger search when text changes
  useEffect(() => {
    if (searchMode === 'text' && textQuery.trim()) {
      setShouldSearch(false);
      debouncedSearch();
    }
  }, [textQuery, searchMode, debouncedSearch]);

  // Image dropzone
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setShouldSearch(true);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
    },
    maxFiles: 1,
  });

  // Handle text search
  const handleTextSearch = () => {
    if (textQuery.trim()) {
      setShouldSearch(true);
      setSearchParams({ q: textQuery });
    }
  };

  // Clear image
  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
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
                className="text-white font-semibold"
              >
                Search
              </Link>
              <Link
                to={`/galleries/${galleryId}/explore`}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                Explore
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        {/* Search Interface */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-4xl mx-auto mb-12"
        >
          <Card>
            <CardContent className="p-6">
              {/* Search Mode Toggle */}
              <div className="flex gap-2 mb-6">
                <Button
                  variant={searchMode === 'text' ? 'default' : 'outline'}
                  onClick={() => setSearchMode('text')}
                  className="flex-1"
                >
                  🔍 Text Search
                </Button>
                <Button
                  variant={searchMode === 'image' ? 'default' : 'outline'}
                  onClick={() => setSearchMode('image')}
                  className="flex-1"
                >
                  🖼️ Image Search
                </Button>
              </div>

              {/* Text Search */}
              {searchMode === 'text' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-4"
                >
                  <div>
                    <Label htmlFor="query">Search Query</Label>
                    <div className="flex gap-2 mt-2">
                      <Input
                        id="query"
                        type="text"
                        placeholder="Describe what you're looking for..."
                        value={textQuery}
                        onChange={(e) => setTextQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleTextSearch();
                          }
                        }}
                        className="flex-1"
                      />
                      <Button onClick={handleTextSearch}>Search</Button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Image Search */}
              {searchMode === 'image' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-4"
                >
                  {!imagePreview ? (
                    <div
                      {...getRootProps()}
                      className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all duration-200 ${
                        isDragActive
                          ? 'border-primary-500 bg-primary-500/10'
                          : 'border-neutral-700 hover:border-primary-500/50 hover:bg-neutral-800/50'
                      }`}
                    >
                      <input {...getInputProps()} />
                      <div className="text-6xl mb-4">📸</div>
                      <p className="text-lg text-neutral-300 mb-2">
                        {isDragActive
                          ? 'Drop your image here...'
                          : 'Drag & drop an image here'}
                      </p>
                      <p className="text-sm text-neutral-500">
                        or click to browse (JPEG, PNG, WebP)
                      </p>
                    </div>
                  ) : (
                    <div className="relative">
                      <img
                        src={imagePreview}
                        alt="Search preview"
                        className="w-full max-h-96 object-contain rounded-lg"
                      />
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={clearImage}
                        className="absolute top-2 right-2"
                      >
                        ✕ Clear
                      </Button>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Advanced Options */}
              <details className="mt-6">
                <summary className="cursor-pointer text-sm text-neutral-400 hover:text-white">
                  Advanced Options
                </summary>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <Label htmlFor="topK">Results Limit</Label>
                    <Input
                      id="topK"
                      type="number"
                      min={1}
                      max={50}
                      value={topK}
                      onChange={(e) => setTopK(Number(e.target.value))}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="minScore">Min Similarity (%)</Label>
                    <Input
                      id="minScore"
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={minScore * 100}
                      onChange={(e) => setMinScore(Number(e.target.value) / 100)}
                      className="mt-2"
                    />
                  </div>
                </div>
              </details>
            </CardContent>
          </Card>
        </motion.div>

        {/* Loading State */}
        <AnimatePresence mode="wait">
          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-12"
            >
              <div className="inline-block w-16 h-16 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-4" />
              <p className="text-neutral-400">Searching artworks...</p>
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
              <SearchResults
                results={results}
                queryTime={currentQuery.data?.queryTime || 0}
              />
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
              <div className="text-6xl mb-4">🔍</div>
              <p className="text-neutral-400">No artworks found</p>
              <p className="text-sm text-neutral-500 mt-2">
                Try adjusting your search query or lowering the minimum similarity
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
