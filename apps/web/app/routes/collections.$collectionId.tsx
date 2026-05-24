import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData, Link, Outlet, useLocation } from '@remix-run/react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Search,
  Upload,
  Sparkles,
  Grid3X3,
  Settings,
  ExternalLink,
} from 'lucide-react';
import { apiClient, getApiClientForRequest } from '~/lib/api';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { ArtworkGrid } from '~/components/gallery/artwork-grid';
import { Logo } from '~/components/ui/logo';
import { UserMenu } from '~/components/user/user-menu';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [
    { title: `${data?.collection.name || 'Collection'} - Paillette` },
    {
      name: 'description',
      content: data?.collection.description || 'Collection dashboard',
    },
  ];
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { collectionId } = params;
  if (!collectionId) {
    throw new Response('Collection ID is required', { status: 400 });
  }

  try {
    const collection = await getApiClientForRequest(request).getGallery(
      collectionId
    );
    return { collection, collectionId };
  } catch (error) {
    throw new Response('Collection not found', { status: 404 });
  }
}

export default function CollectionDashboard() {
  const { collection, collectionId } = useLoaderData<typeof loader>();
  const location = useLocation();

  // Check if we're on a child route
  const isChildRoute = location.pathname !== `/collections/${collectionId}`;

  // Fetch artworks (only for dashboard)
  const { data, isLoading, error } = useQuery({
    queryKey: ['artworks', collectionId],
    queryFn: () => apiClient.listArtworks(collectionId, { limit: 50 }),
    enabled: !isChildRoute,
  });

  const artworks = data?.artworks || [];
  const total = data?.total || 0;

  // If on a child route, just render the outlet
  if (isChildRoute) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Logo linkToHome />
              <p className="text-sm text-neutral-400 mt-1">{collection.name}</p>
            </div>
            <nav className="flex items-center gap-4">
              <Link
                to={`/collections/${collectionId}`}
                className="text-white font-semibold"
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
                className="text-neutral-400 hover:text-white transition-colors"
              >
                Explore
              </Link>
              <Link
                to="/collections"
                className="text-neutral-400 hover:text-white transition-colors"
              >
                All Collections
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
          className="mb-12"
        >
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-4xl lg:text-5xl font-display font-bold mb-4">
                {collection.name}
              </h1>
              {collection.description && (
                <p className="text-lg text-neutral-300 max-w-2xl">
                  {collection.description}
                </p>
              )}
              {collection.website && (
                <a
                  href={collection.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-400 hover:text-primary-300 mt-2 inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-4 w-4" />
                  {collection.website}
                </a>
              )}
            </div>
            <div className="flex gap-3">
              <Button asChild>
                <Link to={`/collections/${collectionId}/search`}>
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/collections/${collectionId}/upload`}>
                  <Upload className="h-4 w-4 mr-2" />
                  Add Images
                </Link>
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription className="flex items-center gap-2">
                  <Grid3X3 className="h-4 w-4" />
                  Total Images
                </CardDescription>
                <CardTitle className="text-3xl">{total}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  With Embeddings
                </CardDescription>
                <CardTitle className="text-3xl">{total}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Public Access</CardDescription>
                <CardTitle className="text-2xl">
                  {collection.isPublic ? 'Enabled' : 'Disabled'}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Search Modes</CardDescription>
                <CardTitle className="text-2xl">Text, Image, Color</CardTitle>
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
                Common tasks to manage your collection
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Button variant="outline" asChild className="h-auto py-4 flex-col">
                <Link to={`/collections/${collectionId}/search`}>
                  <Search className="h-8 w-8 mb-2 text-primary-400" />
                  <span>Search</span>
                </Link>
              </Button>
              <Button variant="outline" asChild className="h-auto py-4 flex-col">
                <Link to={`/collections/${collectionId}/upload`}>
                  <Upload className="h-8 w-8 mb-2 text-primary-400" />
                  <span>Upload</span>
                </Link>
              </Button>
              <Button variant="outline" asChild className="h-auto py-4 flex-col">
                <Link to={`/collections/${collectionId}/explore`}>
                  <Sparkles className="h-8 w-8 mb-2 text-primary-400" />
                  <span>Explore</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col" disabled>
                <Grid3X3 className="h-8 w-8 mb-2" />
                <span>Organize</span>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col" disabled>
                <Settings className="h-8 w-8 mb-2" />
                <span>Settings</span>
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Images Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-display font-bold">Images</h2>
            {total > artworks.length && (
              <Button variant="ghost" size="sm">
                View All ({total})
              </Button>
            )}
          </div>

          {isLoading && (
            <div className="text-center py-12">
              <div className="inline-block w-16 h-16 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-4" />
              <p className="text-neutral-400">Loading images...</p>
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">Warning</div>
              <p className="text-red-400">
                {error instanceof Error ? error.message : 'Failed to load images'}
              </p>
            </div>
          )}

          {!isLoading && !error && artworks.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center">
                <Grid3X3 className="h-16 w-16 mx-auto mb-4 text-neutral-600" />
                <h3 className="text-xl font-semibold mb-2">No images yet</h3>
                <p className="text-neutral-400 mb-6">
                  Start by uploading images to your collection
                </p>
                <Button asChild>
                  <Link to={`/collections/${collectionId}/upload`}>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Images
                  </Link>
                </Button>
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
