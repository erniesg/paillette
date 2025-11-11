import type { MetaFunction } from '@remix-run/cloudflare';
import { motion } from 'framer-motion';

export const meta: MetaFunction = () => {
  return [
    { title: 'Paillette - AI-Powered Gallery Platform' },
    {
      name: 'description',
      content:
        'Multimodal search and management platform for galleries worldwide',
    },
  ];
};

export default function Index() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white overflow-hidden">
      {/* Ambient background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 right-20 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl animate-float" />
        <div
          className="absolute bottom-20 left-20 w-96 h-96 bg-accent-500/10 rounded-full blur-3xl animate-float"
          style={{ animationDelay: '3s' }}
        />
      </div>

      {/* Main content */}
      <div className="relative z-10">
        {/* Hero section */}
        <div className="container mx-auto px-6 py-20 lg:py-32">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center max-w-5xl mx-auto"
          >
            {/* Artistic logo */}
            <div className="mb-8 lg:mb-12">
              <h1 className="text-7xl lg:text-9xl font-display font-bold tracking-tight">
                <span className="text-white">P</span>
                <span className="bg-gradient-accent bg-clip-text text-transparent animate-glow">
                  ai
                </span>
                <span className="text-white">llette</span>
              </h1>
            </div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.8 }}
              className="text-xl lg:text-2xl text-neutral-300 mb-8 max-w-3xl mx-auto leading-relaxed"
            >
              AI-powered multimodal search and management platform for galleries
              worldwide
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="flex flex-col sm:flex-row gap-4 justify-center items-center"
            >
              <a
                href="/galleries"
                className="group relative px-8 py-4 bg-gradient-accent rounded-full font-semibold text-lg transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-primary-500/50"
              >
                <span className="relative z-10">Get Started</span>
              </a>
              <a
                href="#features"
                className="px-8 py-4 border-2 border-primary-500/50 rounded-full font-semibold text-lg transition-all duration-300 hover:border-primary-400 hover:bg-primary-500/10"
              >
                Explore Features
              </a>
            </motion.div>
          </motion.div>
        </div>

        {/* Features section */}
        <div id="features" className="container mx-auto px-6 py-20 lg:py-32">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl lg:text-5xl font-display font-bold mb-4">
              Powerful Features
            </h2>
            <p className="text-xl text-neutral-400 max-w-2xl mx-auto">
              Everything you need to manage and discover art
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
            <FeatureCard
              title="Multimodal Search"
              description="Search artworks using text, images, or colors with AI-powered embeddings"
              icon="🔍"
              delay={0}
            />
            <FeatureCard
              title="Metadata Management"
              description="Upload and manage artwork metadata via CSV with bulk operations"
              icon="📊"
              delay={0.1}
            />
            <FeatureCard
              title="Embedding Projector"
              description="Visualize artwork collections in interactive 2D/3D embedding space"
              icon="🎨"
              delay={0.2}
            />
            <FeatureCard
              title="Frame Removal"
              description="Automatically remove picture frames from uploaded artwork images"
              icon="🖼️"
              delay={0.3}
            />
            <FeatureCard
              title="Multi-Language"
              description="Instant translation to English, Chinese, Tamil, and Malay"
              icon="🌏"
              delay={0.4}
              link="/translate"
            />
            <FeatureCard
              title="Public API"
              description="RESTful API with authentication for integrations"
              icon="🔌"
              delay={0.5}
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="container mx-auto px-6 py-12 text-center border-t border-neutral-800">
          <p className="text-neutral-500">
            © {new Date().getFullYear()} Paillette. Making collections shine
            with AI.
          </p>
        </footer>
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  description,
  icon,
  delay,
  link,
}: {
  title: string;
  description: string;
  icon: string;
  delay: number;
  link?: string;
}) {
  const content = (
    <>
      <div className="text-5xl mb-4 group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      <h3 className="text-xl font-display font-semibold mb-3 text-white">
        {title}
      </h3>
      <p className="text-neutral-400 leading-relaxed">{description}</p>

      {/* Gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-500/0 to-accent-500/0 group-hover:from-primary-500/5 group-hover:to-accent-500/5 rounded-2xl transition-all duration-300" />
    </>
  );

  const className =
    'group relative bg-gradient-to-br from-neutral-900/80 to-neutral-800/50 backdrop-blur-sm border border-neutral-800 rounded-2xl p-8 transition-all duration-300 hover:border-primary-500/50 hover:shadow-xl hover:shadow-primary-500/10 block';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay }}
      whileHover={{ scale: 1.05, y: -5 }}
    >
      {link ? (
        <a href={link} className={className}>
          {content}
        </a>
      ) : (
        <div className={className}>
          {content}
        </div>
      )}
    </motion.div>
  );
}
