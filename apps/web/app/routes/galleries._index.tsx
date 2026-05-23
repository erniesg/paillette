import type { MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { apiClient } from '~/lib/api';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Logo } from '~/components/ui/logo';
import { UserMenu } from '~/components/user/user-menu';

export const meta: MetaFunction = () => {
  return [
    { title: 'Galleries - Paillette' },
    { name: 'description', content: 'Browse all galleries on Paillette' },
  ];
};

export default function GalleriesIndex() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    website: '',
    country: '',
    city: '',
  });
  const [apiKey, setApiKey] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const {
    data: galleries,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['galleries'],
    queryFn: () => apiClient.listGalleries(),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return await apiClient.createGallery({
        name: formData.name,
        slug: formData.name
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, ''),
        description: formData.description || undefined,
        website: formData.website || undefined,
        location:
          formData.country && formData.city
            ? {
                country: formData.country,
                city: formData.city,
              }
            : undefined,
        settings: {
          allowPublicAccess: true,
          enableEmbeddingProjector: true,
          defaultLanguage: 'en',
          supportedLanguages: ['en'],
        },
        ownerId: crypto.randomUUID(), // Generate valid UUID (backend will override with auth user)
      });
    },
    onSuccess: (data) => {
      setApiKey(data.api_key);
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      setFormData({
        name: '',
        description: '',
        website: '',
        country: '',
        city: '',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    createMutation.mutate();
  };

  const handleCloseModal = () => {
    setIsCreateModalOpen(false);
    setApiKey(null);
    createMutation.reset();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Logo linkToHome />
            <div className="flex items-center gap-4">
              <Link to="/galleries" className="text-white font-semibold">
                Galleries
              </Link>
              <Link
                to="/translate"
                className="text-neutral-400 hover:text-white transition-colors"
              >
                Translate
              </Link>
              <div className="ml-2 pl-4 border-l border-neutral-700">
                <UserMenu />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-12">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl lg:text-5xl font-display font-bold mb-4">
            Explore Galleries
          </h1>
          <p className="text-lg text-neutral-300 max-w-2xl mx-auto">
            Discover art collections from galleries worldwide
          </p>
        </motion.div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="inline-block w-16 h-16 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-4" />
            <p className="text-neutral-400">Loading galleries...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">⚠️</div>
            <p className="text-red-400">
              {error instanceof Error
                ? error.message
                : 'Failed to load galleries'}
            </p>
          </div>
        )}

        {/* Galleries Grid */}
        {!isLoading && !error && galleries && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto"
          >
            {galleries.map((gallery, index) => {
              const galleryRouteId = gallery.slug || gallery.id;

              return (
                <motion.div
                  key={gallery.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className="h-full hover:border-primary-500/50 transition-all duration-300 hover:shadow-xl hover:shadow-primary-500/10">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span>{gallery.name}</span>
                        {gallery.isPublic && (
                          <span className="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded-full border border-green-500/30">
                            Public
                          </span>
                        )}
                      </CardTitle>
                      {gallery.description && (
                        <CardDescription className="line-clamp-2">
                          {gallery.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {gallery.website && (
                        <a
                          href={gallery.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary-400 hover:text-primary-300 block truncate"
                        >
                          🌐 {gallery.website}
                        </a>
                      )}
                      <div>
                        <Button
                          asChild
                          variant="outline"
                          className="w-full"
                          size="sm"
                        >
                          <Link to={`/${galleryRouteId}/search`}>
                            Search collection
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Empty State */}
        {!isLoading && !error && galleries && galleries.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🎨</div>
            <h3 className="text-xl font-semibold mb-2">No galleries yet</h3>
            <p className="text-neutral-400 mb-6">
              Be the first to create a gallery
            </p>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              + Create Gallery
            </Button>
          </div>
        )}
      </div>

      {/* Create Gallery Modal */}
      <AnimatePresence>
        {isCreateModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={handleCloseModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl"
            >
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-2xl">
                        Create New Gallery
                      </CardTitle>
                      <CardDescription>
                        {apiKey
                          ? 'Save your API key - it will only be shown once!'
                          : 'Set up your art gallery on Paillette'}
                      </CardDescription>
                    </div>
                    <button
                      onClick={handleCloseModal}
                      className="text-neutral-400 hover:text-white transition-colors"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  {apiKey ? (
                    /* API Key Display */
                    <div className="space-y-4">
                      <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                        <p className="text-sm text-green-300 mb-2 font-semibold">
                          Gallery created successfully!
                        </p>
                        <p className="text-sm text-neutral-300 mb-4">
                          Save this API key securely. You won't be able to see
                          it again.
                        </p>
                        <div className="bg-neutral-900 rounded-lg p-3 font-mono text-sm break-all border border-neutral-700">
                          {apiKey}
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <Button
                          onClick={() => {
                            navigator.clipboard.writeText(apiKey);
                          }}
                          variant="outline"
                          className="flex-1"
                        >
                          Copy API Key
                        </Button>
                        <Button onClick={handleCloseModal} className="flex-1">
                          Done
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Create Form */
                    <form onSubmit={handleSubmit} className="space-y-6">
                      {/* Name */}
                      <div className="space-y-2">
                        <label
                          htmlFor="name"
                          className="text-sm font-medium text-neutral-200"
                        >
                          Gallery Name <span className="text-red-400">*</span>
                        </label>
                        <input
                          id="name"
                          type="text"
                          value={formData.name}
                          onChange={(e) =>
                            setFormData({ ...formData, name: e.target.value })
                          }
                          placeholder="e.g., National Gallery Singapore"
                          required
                          className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                        />
                      </div>

                      {/* Description */}
                      <div className="space-y-2">
                        <label
                          htmlFor="description"
                          className="text-sm font-medium text-neutral-200"
                        >
                          Description
                        </label>
                        <textarea
                          id="description"
                          value={formData.description}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              description: e.target.value,
                            })
                          }
                          placeholder="Brief description of your gallery..."
                          rows={3}
                          className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 resize-none focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                        />
                      </div>

                      {/* Location */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label
                            htmlFor="country"
                            className="text-sm font-medium text-neutral-200"
                          >
                            Country
                          </label>
                          <input
                            id="country"
                            type="text"
                            value={formData.country}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                country: e.target.value,
                              })
                            }
                            placeholder="e.g., Singapore"
                            className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                          />
                        </div>
                        <div className="space-y-2">
                          <label
                            htmlFor="city"
                            className="text-sm font-medium text-neutral-200"
                          >
                            City
                          </label>
                          <input
                            id="city"
                            type="text"
                            value={formData.city}
                            onChange={(e) =>
                              setFormData({ ...formData, city: e.target.value })
                            }
                            placeholder="e.g., Singapore"
                            className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                          />
                        </div>
                      </div>

                      {/* Website */}
                      <div className="space-y-2">
                        <label
                          htmlFor="website"
                          className="text-sm font-medium text-neutral-200"
                        >
                          Website
                        </label>
                        <input
                          id="website"
                          type="url"
                          value={formData.website}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              website: e.target.value,
                            })
                          }
                          placeholder="https://example.com"
                          className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                        />
                      </div>

                      {/* Error Display */}
                      {createMutation.isError && (
                        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                          {createMutation.error?.message ||
                            'Failed to create gallery'}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-3 pt-4">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCloseModal}
                          disabled={createMutation.isPending}
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={
                            !formData.name.trim() || createMutation.isPending
                          }
                          className="flex-1"
                        >
                          {createMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            'Create Gallery'
                          )}
                        </Button>
                      </div>
                    </form>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
