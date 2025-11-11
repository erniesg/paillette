import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData, Link } from '@remix-run/react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { apiClient } from '~/lib/api';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { ArtworkGrid } from '~/components/gallery/artwork-grid';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [
    { title: `${data?.gallery.name || 'Gallery'} - Paillette` },
    {
      name: 'description',
      content: data?.gallery.description || 'Gallery dashboard',
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

export default function GalleryDashboard() {
  const { gallery, galleryId } = useLoaderData<typeof loader>();

  // Fetch artworks
  const { data, isLoading, error } = useQuery({
    queryKey: ['artworks', galleryId],
    queryFn: () => apiClient.listArtworks(galleryId, { limit: 50 }),
  });

  const artworks = data?.artworks || [];
  const total = data?.total || 0;

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
                className="text-white font-semibold"
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
          className="mb-12"
        >
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-4xl lg:text-5xl font-display font-bold mb-4">
                {gallery.name}
              </h1>
              {gallery.description && (
                <p className="text-lg text-neutral-300 max-w-2xl">
                  {gallery.description}
                </p>
              )}
              {gallery.website && (
                <a
                  href={gallery.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-400 hover:text-primary-300 mt-2 inline-block"
                >
                  🌐 {gallery.website}
                </a>
              )}
            </div>
            <div className="flex gap-3">
              <Button asChild>
                <Link to={`/galleries/${galleryId}/search`}>
                  🔍 Search Artworks
                </Link>
              </Button>
              <Button variant="outline">+ Upload Artwork</Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Total Artworks</CardDescription>
                <CardTitle className="text-3xl">{total}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Public Access</CardDescription>
                <CardTitle className="text-2xl">
                  {gallery.isPublic ? '✓ Enabled' : '✗ Disabled'}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Languages Supported</CardDescription>
                <CardTitle className="text-2xl">
                  {gallery.settings?.supportedLanguages?.length || 0}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8"
        >
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>
                Common tasks to manage your gallery
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Button variant="outline" asChild className="h-auto py-4 flex-col">
                <Link to={`/galleries/${galleryId}/search`}>
                  <span className="text-3xl mb-2">🔍</span>
                  <span>Search</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col" disabled>
                <span className="text-3xl mb-2">📤</span>
                <span>Upload</span>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col" disabled>
                <span className="text-3xl mb-2">📊</span>
                <span>Import CSV</span>
              </Button>
              <Button variant="outline" asChild className="h-auto py-4 flex-col">
                <Link to={`/galleries/${galleryId}/explore`}>
                  <span className="text-3xl mb-2">🎨</span>
                  <span>Explore</span>
                </Link>
              </Button>
              <Button variant="outline" asChild className="h-auto py-4 flex-col">
                <Link to={`/galleries/${galleryId}/frame-removal`}>
                  <span className="text-3xl mb-2">🖼️</span>
                  <span>Frame Removal</span>
                </Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Artworks Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-display font-bold">Recent Artworks</h2>
            {total > artworks.length && (
              <Button variant="ghost" size="sm">
                View All ({total})
              </Button>
            )}
          </div>

          {isLoading && (
            <div className="text-center py-12">
              <div className="inline-block w-16 h-16 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-4" />
              <p className="text-neutral-400">Loading artworks...</p>
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">⚠️</div>
              <p className="text-red-400">
                {error instanceof Error ? error.message : 'Failed to load artworks'}
              </p>
            </div>
          )}

          {!isLoading && !error && artworks.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center">
                <div className="text-6xl mb-4">🎨</div>
                <h3 className="text-xl font-semibold mb-2">No artworks yet</h3>
                <p className="text-neutral-400 mb-6">
                  Start by uploading your first artwork
                </p>
                <Button>+ Upload Artwork</Button>
              </CardContent>
            </Card>
          )}

          {!isLoading && !error && artworks.length > 0 && (
            <ArtworkGrid artworks={artworks} />
          )}
        </motion.div>
      </div>
    </div>
  );
}
