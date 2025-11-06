import type { MetaFunction } from '@remix-run/cloudflare';

export const meta: MetaFunction = () => {
  return [
    { title: 'Paillette - AI-Powered Art Gallery Platform' },
    {
      name: 'description',
      content:
        'Multimodal search and management platform for art galleries worldwide',
    },
  ];
};

export default function Index() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100">
      <div className="container mx-auto px-4 py-16">
        <header className="text-center mb-16">
          <h1 className="text-6xl font-bold text-gray-900 mb-4">
            Paillette
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            AI-powered multimodal search and management platform for art
            galleries worldwide
          </p>
        </header>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          <FeatureCard
            title="Multimodal Search"
            description="Search artworks using text, images, or colors with AI-powered embeddings"
            icon="🔍"
          />
          <FeatureCard
            title="Metadata Management"
            description="Upload and manage artwork metadata via CSV with bulk operations"
            icon="📊"
          />
          <FeatureCard
            title="Embedding Projector"
            description="Visualize artwork collections in interactive 2D/3D embedding space"
            icon="🎨"
          />
          <FeatureCard
            title="Frame Removal"
            description="Automatically remove picture frames from uploaded artwork images"
            icon="🖼️"
          />
          <FeatureCard
            title="Multi-Language"
            description="Instant translation to English, Chinese, Tamil, and Malay"
            icon="🌏"
          />
          <FeatureCard
            title="Public API"
            description="RESTful API with authentication for integrations"
            icon="🔌"
          />
        </div>

        <div className="text-center mt-16">
          <a href="/galleries" className="btn-primary">
            Get Started
          </a>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="card hover:shadow-xl transition-shadow">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-600">{description}</p>
    </div>
  );
}
