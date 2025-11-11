/**
 * Translation Tool Page
 * Text and document translation with multi-language support
 */

import type { MetaFunction } from '@remix-run/cloudflare';
import { useState } from 'react';
import { Link } from '@remix-run/react';
import { motion } from 'framer-motion';
import { Languages, FileText, Type } from 'lucide-react';
import { Card } from '~/components/ui/card';
import { TextTranslator } from '~/components/translate/text-translator';
import { DocumentTranslator } from '~/components/translate/document-translator';
import { cn } from '~/lib/utils';

export const meta: MetaFunction = () => {
  return [
    { title: 'Translate - Paillette' },
    {
      name: 'description',
      content: 'Translate text and documents between English, Chinese, Malay, and Tamil',
    },
  ];
};

type Tab = 'text' | 'document';

export default function TranslatePage() {
  const [activeTab, setActiveTab] = useState<Tab>('text');

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
              <p className="text-sm text-neutral-400 mt-1">Translation Tool</p>
            </div>
            <nav className="flex items-center gap-4">
              <Link
                to="/galleries"
                className="text-neutral-400 hover:text-white transition-colors"
              >
                Galleries
              </Link>
              <Link to="/translate" className="text-white font-semibold">
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
          className="mb-8"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-xl bg-gradient-accent">
              <Languages className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-4xl lg:text-5xl font-display font-bold">Translation Tool</h1>
              <p className="text-lg text-neutral-300 mt-2">
                Translate text and documents between English, Chinese, Malay, and Tamil
              </p>
            </div>
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Link to="/" className="hover:text-white transition-colors">
              Home
            </Link>
            <span>/</span>
            <span className="text-white">Translate</span>
          </div>
        </motion.div>

        {/* Tab Navigation */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6"
        >
          <Card className="p-2">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('text')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium transition-all duration-200',
                  activeTab === 'text'
                    ? 'bg-gradient-accent text-white shadow-lg'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
                )}
              >
                <Type className="h-5 w-5" />
                <span>Text Translation</span>
              </button>

              <button
                onClick={() => setActiveTab('document')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium transition-all duration-200',
                  activeTab === 'document'
                    ? 'bg-gradient-accent text-white shadow-lg'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
                )}
              >
                <FileText className="h-5 w-5" />
                <span>Document Translation</span>
              </button>
            </div>
          </Card>
        </motion.div>

        {/* Tab Content */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          {activeTab === 'text' && <TextTranslator />}
          {activeTab === 'document' && <DocumentTranslator />}
        </motion.div>

        {/* Info Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-12"
        >
          <Card className="p-6">
            <h2 className="text-xl font-display font-semibold mb-4">Supported Languages</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-neutral-800/50">
                <span className="text-3xl">🇬🇧</span>
                <div>
                  <p className="font-medium">English</p>
                  <p className="text-sm text-neutral-400">EN</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-neutral-800/50">
                <span className="text-3xl">🇨🇳</span>
                <div>
                  <p className="font-medium">Chinese</p>
                  <p className="text-sm text-neutral-400">ZH</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-neutral-800/50">
                <span className="text-3xl">🇲🇾</span>
                <div>
                  <p className="font-medium">Malay</p>
                  <p className="text-sm text-neutral-400">MS</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-neutral-800/50">
                <span className="text-3xl">🇮🇳</span>
                <div>
                  <p className="font-medium">Tamil</p>
                  <p className="text-sm text-neutral-400">TA</p>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 rounded-lg bg-primary-500/10 border border-primary-500/30">
              <h3 className="font-semibold mb-2 text-primary-300">Features</h3>
              <ul className="space-y-2 text-sm text-neutral-300">
                <li className="flex items-center gap-2">
                  <span className="text-primary-400">✓</span>
                  <span>Instant text translation up to 10,000 characters</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-primary-400">✓</span>
                  <span>Document translation for TXT, PDF, and DOCX files</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-primary-400">✓</span>
                  <span>Automatic caching for cost optimization</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-primary-400">✓</span>
                  <span>Multi-provider AI translation (Youdao, OpenAI, Google)</span>
                </li>
              </ul>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
