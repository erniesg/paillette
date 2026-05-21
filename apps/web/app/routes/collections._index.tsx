import type { MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Search, Grid3X3, Sparkles } from 'lucide-react';
import { apiClient } from '~/lib/api';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Logo } from '~/components/ui/logo';
import { UserMenu } from '~/components/user/user-menu';

export const meta: MetaFunction = () => {
  return [
    { title: 'Collections - Paillette' },
    { name: 'description', content: 'Browse and manage your image collections' },
  ];
};

export default function CollectionsIndex() {
  const { data: galleries, isLoading, error } = useQuery({
    queryKey: ['galleries'],
    queryFn: () => apiClient.listGalleries(),
  });

  // For now, we map galleries to collections
  const collections = galleries || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Logo linkToHome />
            <div className="flex items-center gap-4">
              <Link to="/collections" className="text-white font-semibold">
                Collections
              </Link>
              <Link to="/translate" className="text-neutral-400 hover:text-white transition-colors">
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
            Your Collections
          </h1>
          <p className="text-lg text-neutral-300 max-w-2xl mx-auto mb-8">
            Upload images, generate embeddings, and create AI-powered search experiences
          </p>
          <Button asChild size="lg" className="gap-2">
            <Link to="/collections/new">
              <Plus className="h-5 w-5" />
              New Collection
            </Link>
          </Button>
        </motion.div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="inline-block w-16 h-16 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-4" />
            <p className="text-neutral-400">Loading collections...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">Warning</div>
            <p className="text-red-400">
              {error instanceof Error ? error.message : 'Failed to load collections'}
            </p>
          </div>
        )}

        {/* Collections Grid */}
        {!isLoading && !error && collections.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto"
          >
            {collections.map((collection, index) => (
              <motion.div
                key={collection.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="h-full hover:border-primary-500/50 transition-all duration-300 hover:shadow-xl hover:shadow-primary-500/10 group">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span className="truncate">{collection.name}</span>
                      {collection.isPublic && (
                        <span className="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded-full border border-green-500/30 flex-shrink-0">
                          Public
                        </span>
                      )}
                    </CardTitle>
                    {collection.description && (
                      <CardDescription className="line-clamp-2">
                        {collection.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Quick Stats */}
                    <div className="flex items-center gap-4 text-sm text-neutral-400">
                      <div className="flex items-center gap-1">
                        <Grid3X3 className="h-4 w-4" />
                        <span>Images</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Sparkles className="h-4 w-4" />
                        <span>Embeddings</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button asChild className="flex-1" size="sm">
                        <Link to={`/collections/${collection.id}`}>
                          <Grid3X3 className="h-4 w-4 mr-1" />
                          View
                        </Link>
                      </Button>
                      <Button asChild variant="outline" className="flex-1" size="sm">
                        <Link to={`/collections/${collection.id}/search`}>
                          <Search className="h-4 w-4 mr-1" />
                          Search
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Empty State */}
        {!isLoading && !error && collections.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-16"
          >
            <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-neutral-800/50 flex items-center justify-center">
              <Grid3X3 className="h-12 w-12 text-neutral-500" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No collections yet</h3>
            <p className="text-neutral-400 mb-8 max-w-md mx-auto">
              Create your first collection by uploading a ZIP file or dragging in images
            </p>
            <Button asChild size="lg" className="gap-2">
              <Link to="/collections/new">
                <Plus className="h-5 w-5" />
                Create Your First Collection
              </Link>
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
