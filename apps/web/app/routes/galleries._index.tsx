import type { MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { apiClient } from '~/lib/api';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

export const meta: MetaFunction = () => {
  return [
    { title: 'Galleries - Paillette' },
    { name: 'description', content: 'Browse all galleries on Paillette' },
  ];
};

export default function GalleriesIndex() {
  const { data: galleries, isLoading, error } = useQuery({
    queryKey: ['galleries'],
    queryFn: () => apiClient.listGalleries(),
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <Link
            to="/"
            className="text-2xl font-display font-bold bg-gradient-accent bg-clip-text text-transparent hover:opacity-80 transition-opacity"
          >
            Paillette
          </Link>
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
              {error instanceof Error ? error.message : 'Failed to load galleries'}
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
            {galleries.map((gallery, index) => (
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
                    <div className="flex gap-2">
                      <Button asChild className="flex-1" size="sm">
                        <Link to={`/galleries/${gallery.id}`}>
                          📊 Dashboard
                        </Link>
                      </Button>
                      <Button asChild variant="outline" className="flex-1" size="sm">
                        <Link to={`/galleries/${gallery.id}/search`}>
                          🔍 Search
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
        {!isLoading && !error && galleries && galleries.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🎨</div>
            <h3 className="text-xl font-semibold mb-2">No galleries yet</h3>
            <p className="text-neutral-400 mb-6">
              Be the first to create a gallery
            </p>
            <Button>+ Create Gallery</Button>
          </div>
        )}
      </div>
    </div>
  );
}
