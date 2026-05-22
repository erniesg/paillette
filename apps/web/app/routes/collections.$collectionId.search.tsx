import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData, useSearchParams, Link } from '@remix-run/react';
import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import { Search, Image as ImageIcon, Palette, ArrowLeft, Sparkles } from 'lucide-react';
import { apiClient } from '~/lib/api';
import { debounce } from '~/lib/utils';
import { SearchResults } from '~/components/search/search-results';
import { ColorPicker } from '~/components/ui/color-picker';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Card, CardContent } from '~/components/ui/card';
import { Logo } from '~/components/ui/logo';
import { UserMenu } from '~/components/user/user-menu';
import { useUser } from '~/contexts/user-context';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [
    { title: `Search ${data?.collection.name || 'Collection'} - Paillette` },
    {
      name: 'description',
      content: 'Search and discover images using AI-powered multimodal search',
    },
  ];
};

export async function loader({ params }: LoaderFunctionArgs) {
  const { collectionId } = params;
  if (!collectionId) {
    throw new Response('Collection ID is required', { status: 400 });
  }

  try {
    const collection = await apiClient.getGallery(collectionId);
    return { collection, collectionId };
  } catch (error) {
    throw new Response('Collection not found', { status: 404 });
  }
}

export default function CollectionSearchPage() {
  const { collection, collectionId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getAccessToken, isAuthenticated } = useUser();
  const optionalAccessToken = isAuthenticated ? getAccessToken : undefined;

  // Search state
  const [searchMode, setSearchMode] = useState<'text' | 'image' | 'color'>('text');
  const [textQuery, setTextQuery] = useState(searchParams.get('q') || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [colorMatchMode, setColorMatchMode] = useState<'any' | 'all'>('any');
  const [topK, setTopK] = useState(20);
  const [minScore, setMinScore] = useState(0.5);
  const [shouldSearch, setShouldSearch] = useState(false);

  // Text search query
  const textSearchQuery = useQuery({
    queryKey: ['search', 'text', collectionId, textQuery, topK, minScore, isAuthenticated],
    queryFn: async () => {
      if (!textQuery.trim()) return null;
      return apiClient.searchText(collectionId, {
        query: textQuery,
        topK,
        minScore,
      }, optionalAccessToken);
    },
    enabled: searchMode === 'text' && shouldSearch && textQuery.trim().length > 0,
  });

  // Image search query
  const imageSearchQuery = useQuery({
    queryKey: ['search', 'image', collectionId, imageFile?.name, topK, minScore, isAuthenticated],
    queryFn: async () => {
      if (!imageFile) return null;
      return apiClient.searchImage(collectionId, {
        image: imageFile,
        topK,
        minScore,
      }, optionalAccessToken);
    },
    enabled: searchMode === 'image' && shouldSearch && imageFile !== null,
  });

  // Color search query
  const colorSearchQuery = useQuery({
    queryKey: ['search', 'color', collectionId, selectedColors, colorMatchMode, isAuthenticated],
    queryFn: async () => {
      if (selectedColors.length === 0) return null;
      return apiClient.searchColor(collectionId, {
        colors: selectedColors,
        matchMode: colorMatchMode,
        threshold: 15,
        limit: topK,
      }, optionalAccessToken);
    },
    enabled: searchMode === 'color' && shouldSearch && selectedColors.length > 0,
  });

  // Get current results based on mode
  const currentQuery =
    searchMode === 'text' ? textSearchQuery :
    searchMode === 'image' ? imageSearchQuery :
    colorSearchQuery;

  // Normalize results from different search modes
  const rawResults = currentQuery.data?.results || [];
  const results = rawResults.map((r: any) => ({
    id: r.id || r.artworkId,
    galleryId: r.galleryId || collectionId,
    title: r.title,
    artist: r.artist,
    year: r.year,
    imageUrl: r.imageUrl,
    thumbnailUrl: r.thumbnailUrl,
    similarity: r.similarity ?? (1 - (r.averageDistance || 0) / 100),
    metadata: r.metadata,
  }));
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
                className="text-white font-semibold"
              >
                Search
              </Link>
              <Link
                to={`/collections/${collectionId}/explore`}
                className="text-neutral-400 hover:text-white transition-colors"
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
        {/* Page Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h1 className="text-3xl font-display font-bold mb-2">
            Search {collection.name}
          </h1>
          <p className="text-neutral-400">
            Find images using text, visual similarity, or color palette
          </p>
        </motion.div>

        {/* Search Interface */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="max-w-4xl mx-auto mb-12"
        >
          <Card>
            <CardContent className="p-6">
              {/* Search Mode Toggle */}
              <div className="flex gap-2 mb-6">
                <Button
                  variant={searchMode === 'text' ? 'default' : 'outline'}
                  onClick={() => setSearchMode('text')}
                  className="flex-1 gap-2"
                >
                  <Search className="h-4 w-4" />
                  Text
                </Button>
                <Button
                  variant={searchMode === 'image' ? 'default' : 'outline'}
                  onClick={() => setSearchMode('image')}
                  className="flex-1 gap-2"
                >
                  <ImageIcon className="h-4 w-4" />
                  Image
                </Button>
                <Button
                  variant={searchMode === 'color' ? 'default' : 'outline'}
                  onClick={() => setSearchMode('color')}
                  className="flex-1 gap-2"
                >
                  <Palette className="h-4 w-4" />
                  Color
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
                      <Button onClick={handleTextSearch}>
                        <Search className="h-4 w-4 mr-2" />
                        Search
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm text-neutral-500">
                    Try: "sunset landscape", "portrait with blue tones", "abstract geometric patterns"
                  </p>
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
                      <ImageIcon className="h-16 w-16 mx-auto mb-4 text-neutral-500" />
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
                        Clear
                      </Button>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Color Search */}
              {searchMode === 'color' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-4"
                >
                  <ColorPicker
                    value={selectedColors}
                    onChange={setSelectedColors}
                    maxColors={5}
                  />

                  <div className="flex items-center gap-4 pt-2">
                    <Label className="text-sm">Match Mode:</Label>
                    <div className="flex gap-2">
                      <Button
                        variant={colorMatchMode === 'any' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setColorMatchMode('any')}
                      >
                        ANY color
                      </Button>
                      <Button
                        variant={colorMatchMode === 'all' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setColorMatchMode('all')}
                      >
                        ALL colors
                      </Button>
                    </div>
                    <Button
                      onClick={() => {
                        if (selectedColors.length > 0) {
                          setShouldSearch(true);
                        }
                      }}
                      disabled={selectedColors.length === 0}
                      className="ml-auto"
                    >
                      Search by Color
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* Advanced Options */}
              <details className="mt-6">
                <summary className="cursor-pointer text-sm text-neutral-400 hover:text-white">
                  Advanced Options
                </summary>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <Label htmlFor="topK">Max Results</Label>
                    <Input
                      id="topK"
                      type="number"
                      min={1}
                      max={100}
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

        {/* Results */}
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
              <p className="text-neutral-400">Searching...</p>
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
              <div className="text-6xl mb-4">Warning</div>
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
                queryTime={(currentQuery.data as any)?.queryTime || (currentQuery.data as any)?.took || 0}
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
              <Search className="h-16 w-16 mx-auto mb-4 text-neutral-600" />
              <p className="text-neutral-400">No images found</p>
              <p className="text-sm text-neutral-500 mt-2">
                Try adjusting your search query or lowering the minimum similarity
              </p>
            </motion.div>
          )}

          {/* Initial State */}
          {!isLoading && !error && !shouldSearch && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-12"
            >
              <Sparkles className="h-16 w-16 mx-auto mb-4 text-neutral-600" />
              <p className="text-neutral-400">
                Enter a search query to find similar images
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
