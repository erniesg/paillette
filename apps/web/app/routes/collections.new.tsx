import type { MetaFunction } from '@remix-run/cloudflare';
import { useNavigate, Link } from '@remix-run/react';
import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  Sparkles,
  Loader2,
  CheckCircle2,
  Search,
  AlertCircle,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Logo } from '~/components/ui/logo';
import { ZipUploader, type ImagePreview } from '~/components/upload/zip-uploader';

export const meta: MetaFunction = () => {
  return [
    { title: 'Create Collection - Paillette' },
    { name: 'description', content: 'Create a new image collection and generate embeddings' },
  ];
};

type Step = 'details' | 'upload' | 'review' | 'processing' | 'complete';

interface ProcessingProgress {
  total: number;
  uploaded: number;
  embeddings: number;
  errors: string[];
}

export default function NewCollectionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Step state
  const [currentStep, setCurrentStep] = useState<Step>('details');

  // Collection details
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Images
  const [selectedImages, setSelectedImages] = useState<ImagePreview[]>([]);

  // Processing state
  const [progress, setProgress] = useState<ProcessingProgress>({
    total: 0,
    uploaded: 0,
    embeddings: 0,
    errors: [],
  });
  const [collectionId, setCollectionId] = useState<string | null>(null);

  // Create collection mutation
  const createCollectionMutation = useMutation({
    mutationFn: async () => {
      const apiBase = typeof window !== 'undefined' && window.location.origin.includes('localhost')
        ? 'http://localhost:8787'
        : 'https://paillette-stg.workers.dev';

      const response = await fetch(`${apiBase}/api/v1/galleries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          description: description || undefined,
          settings: {
            allowPublicAccess: true,
            enableEmbeddingProjector: true,
            defaultLanguage: 'en',
            supportedLanguages: ['en'],
          },
          ownerId: crypto.randomUUID(),
        }),
      });

      const data = await response.json() as { success: boolean; data?: { id: string; api_key: string }; error?: { message: string } };
      if (!data.success || !data.data) {
        throw new Error(data.error?.message || 'Failed to create collection');
      }
      return data.data;
    },
    onSuccess: (data) => {
      setCollectionId(data.id);
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
    },
  });

  // Handle images ready from uploader
  const handleImagesReady = useCallback((images: ImagePreview[]) => {
    setSelectedImages(images);
  }, []);

  // Start processing
  const startProcessing = async () => {
    setCurrentStep('processing');
    setProgress({
      total: selectedImages.length,
      uploaded: 0,
      embeddings: 0,
      errors: [],
    });

    try {
      // First, create the collection if not already created
      let galleryId: string | null = collectionId;
      if (!galleryId) {
        const result = await createCollectionMutation.mutateAsync();
        galleryId = result?.id || null;
      }

      if (!galleryId) {
        throw new Error('Failed to create collection');
      }

      // Upload images in batches
      const batchSize = 5;
      const errors: string[] = [];

      for (let i = 0; i < selectedImages.length; i += batchSize) {
        const batch = selectedImages.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (image) => {
            try {
              // Create FormData for upload
              const formData = new FormData();
              formData.append('image', image.blob, image.filename);
              formData.append('title', image.filename.replace(/\.[^/.]+$/, ''));
              formData.append('gallery_id', galleryId!);

              // Upload to API
              const response = await fetch(
                `${window.location.origin.includes('localhost') ? 'http://localhost:8787' : 'https://paillette-stg.workers.dev'}/api/v1/galleries/${galleryId}/artworks`,
                {
                  method: 'POST',
                  body: formData,
                }
              );

              if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
              }

              setProgress((prev) => ({
                ...prev,
                uploaded: prev.uploaded + 1,
              }));
            } catch (err) {
              console.error(`Failed to upload ${image.filename}:`, err);
              errors.push(image.filename);
              setProgress((prev) => ({
                ...prev,
                errors: [...prev.errors, image.filename],
              }));
            }
          })
        );
      }

      // Trigger embedding generation for all uploaded images
      try {
        const response = await fetch(
          `${window.location.origin.includes('localhost') ? 'http://localhost:8787' : 'https://paillette-stg.workers.dev'}/api/v1/galleries/${galleryId}/embeddings/generate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ forceRegenerate: false }),
          }
        );

        if (response.ok) {
          const data = await response.json() as { data?: { queued?: number } };
          setProgress((prev) => ({
            ...prev,
            embeddings: data.data?.queued || prev.uploaded - prev.errors.length,
          }));
        }
      } catch (err) {
        console.error('Failed to trigger embedding generation:', err);
      }

      // Complete!
      setCurrentStep('complete');
    } catch (err) {
      console.error('Processing failed:', err);
      setProgress((prev) => ({
        ...prev,
        errors: [...prev.errors, 'Processing failed'],
      }));
    }
  };

  // Step navigation
  const canProceed = () => {
    switch (currentStep) {
      case 'details':
        return name.trim().length > 0;
      case 'upload':
        return selectedImages.length > 0;
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const goNext = () => {
    switch (currentStep) {
      case 'details':
        setCurrentStep('upload');
        break;
      case 'upload':
        setCurrentStep('review');
        break;
      case 'review':
        startProcessing();
        break;
    }
  };

  const goBack = () => {
    switch (currentStep) {
      case 'upload':
        setCurrentStep('details');
        break;
      case 'review':
        setCurrentStep('upload');
        break;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/collections" className="text-neutral-400 hover:text-white transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <Logo linkToHome />
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8 max-w-4xl">
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2">
            {(['details', 'upload', 'review', 'processing', 'complete'] as Step[]).map((step, index) => {
              const stepIndex = ['details', 'upload', 'review', 'processing', 'complete'].indexOf(currentStep);
              const isActive = step === currentStep;
              const isCompleted = index < stepIndex;

              return (
                <div key={step} className="flex items-center">
                  {index > 0 && (
                    <div
                      className={`w-12 h-0.5 ${
                        isCompleted ? 'bg-primary-500' : 'bg-neutral-700'
                      }`}
                    />
                  )}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                      isCompleted
                        ? 'bg-primary-500 text-white'
                        : isActive
                        ? 'bg-primary-500/20 text-primary-400 border-2 border-primary-500'
                        : 'bg-neutral-800 text-neutral-500'
                    }`}
                  >
                    {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-center mt-2">
            <span className="text-sm text-neutral-400 capitalize">{currentStep}</span>
          </div>
        </div>

        {/* Step Content */}
        <AnimatePresence mode="wait">
          {/* Step 1: Details */}
          {currentStep === 'details' && (
            <motion.div
              key="details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl">Collection Details</CardTitle>
                  <CardDescription>
                    Give your collection a name and optional description
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <label htmlFor="name" className="text-sm font-medium text-neutral-200">
                      Collection Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Art History Collection"
                      className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="description" className="text-sm font-medium text-neutral-200">
                      Description
                    </label>
                    <textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Brief description of this collection..."
                      rows={3}
                      className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 resize-none focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                    />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 2: Upload */}
          {currentStep === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <Upload className="h-6 w-6" />
                    Upload Images
                  </CardTitle>
                  <CardDescription>
                    Drop a ZIP file or individual images to add to your collection
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ZipUploader onImagesReady={handleImagesReady} />
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 3: Review */}
          {currentStep === 'review' && (
            <motion.div
              key="review"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <Sparkles className="h-6 w-6 text-primary-400" />
                    Ready to Process
                  </CardTitle>
                  <CardDescription>
                    Review your collection and confirm to start generating embeddings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Summary */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-neutral-800/50 rounded-lg">
                      <p className="text-sm text-neutral-400 mb-1">Collection Name</p>
                      <p className="text-lg font-semibold">{name}</p>
                    </div>
                    <div className="p-4 bg-neutral-800/50 rounded-lg">
                      <p className="text-sm text-neutral-400 mb-1">Images to Process</p>
                      <p className="text-lg font-semibold text-primary-400">
                        {selectedImages.length}
                      </p>
                    </div>
                  </div>

                  {/* Preview Thumbnails */}
                  <div>
                    <p className="text-sm text-neutral-400 mb-3">Preview:</p>
                    <div className="grid grid-cols-8 gap-2">
                      {selectedImages.slice(0, 16).map((image) => (
                        <div
                          key={image.id}
                          className="aspect-square rounded-md overflow-hidden bg-neutral-800"
                        >
                          <img
                            src={image.url}
                            alt={image.filename}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ))}
                      {selectedImages.length > 16 && (
                        <div className="aspect-square rounded-md bg-neutral-800 flex items-center justify-center">
                          <span className="text-sm text-neutral-400">
                            +{selectedImages.length - 16}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* What will happen */}
                  <div className="p-4 bg-primary-500/10 border border-primary-500/30 rounded-lg">
                    <h4 className="font-medium text-primary-400 mb-2">What happens next:</h4>
                    <ul className="space-y-2 text-sm text-neutral-300">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary-500" />
                        Create collection "{name}"
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary-500" />
                        Upload {selectedImages.length} images to cloud storage
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary-500" />
                        Generate AI embeddings for visual search
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary-500" />
                        Create search page for your collection
                      </li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 4: Processing */}
          {currentStep === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                    Processing...
                  </CardTitle>
                  <CardDescription>
                    Uploading images and generating embeddings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Uploading images</span>
                      <span>{progress.uploaded} / {progress.total}</span>
                    </div>
                    <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-primary-500"
                        initial={{ width: 0 }}
                        animate={{
                          width: `${(progress.uploaded / progress.total) * 100}%`,
                        }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>

                  {/* Status */}
                  <div className="space-y-2">
                    <p className="text-sm text-neutral-400">
                      {progress.uploaded < progress.total
                        ? `Uploading image ${progress.uploaded + 1} of ${progress.total}...`
                        : 'Generating embeddings...'}
                    </p>
                    {progress.errors.length > 0 && (
                      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <p className="text-sm text-red-400">
                          {progress.errors.length} images failed to upload
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 5: Complete */}
          {currentStep === 'complete' && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <Card>
                <CardContent className="py-12 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', delay: 0.2 }}
                    className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-500/20 flex items-center justify-center"
                  >
                    <CheckCircle2 className="h-10 w-10 text-green-400" />
                  </motion.div>

                  <h2 className="text-2xl font-bold mb-2">Collection Created!</h2>
                  <p className="text-neutral-400 mb-8">
                    {progress.uploaded} images uploaded successfully.
                    {progress.errors.length > 0 && ` ${progress.errors.length} failed.`}
                  </p>

                  {progress.errors.length > 0 && (
                    <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-left max-w-md mx-auto">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-4 w-4 text-yellow-400" />
                        <span className="text-sm font-medium text-yellow-400">
                          Some images failed to upload:
                        </span>
                      </div>
                      <ul className="text-xs text-neutral-400 space-y-1">
                        {progress.errors.slice(0, 5).map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                        {progress.errors.length > 5 && (
                          <li>...and {progress.errors.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  )}

                  <div className="flex gap-4 justify-center">
                    <Button
                      variant="outline"
                      onClick={() => navigate(`/collections/${collectionId}`)}
                    >
                      View Collection
                    </Button>
                    <Button
                      onClick={() => navigate(`/collections/${collectionId}/search`)}
                      className="gap-2"
                    >
                      <Search className="h-4 w-4" />
                      Go to Search
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation Buttons */}
        {currentStep !== 'processing' && currentStep !== 'complete' && (
          <div className="mt-6 flex justify-between">
            <Button
              variant="outline"
              onClick={goBack}
              disabled={currentStep === 'details'}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={goNext}
              disabled={!canProceed()}
              className="gap-2"
            >
              {currentStep === 'review' ? (
                <>
                  <Sparkles className="h-4 w-4" />
                  Start Processing
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
