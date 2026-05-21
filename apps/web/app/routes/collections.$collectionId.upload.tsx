import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData, Link, useNavigate } from '@remix-run/react';
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Upload,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { apiClient } from '~/lib/api';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Logo } from '~/components/ui/logo';
import { ZipUploader, type ImagePreview } from '~/components/upload/zip-uploader';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [
    { title: `Upload to ${data?.collection.name || 'Collection'} - Paillette` },
    { name: 'description', content: 'Upload images to your collection' },
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

type Step = 'upload' | 'review' | 'processing' | 'complete';

interface ProcessingProgress {
  total: number;
  uploaded: number;
  errors: string[];
}

export default function CollectionUploadPage() {
  const { collection, collectionId } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // Step state
  const [currentStep, setCurrentStep] = useState<Step>('upload');

  // Images
  const [selectedImages, setSelectedImages] = useState<ImagePreview[]>([]);

  // Processing state
  const [progress, setProgress] = useState<ProcessingProgress>({
    total: 0,
    uploaded: 0,
    errors: [],
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
      errors: [],
    });

    const apiBase = window.location.origin.includes('localhost')
      ? 'http://localhost:8787'
      : 'https://paillette-stg.workers.dev';

    try {
      // Upload images in batches
      const batchSize = 5;
      const errors: string[] = [];

      for (let i = 0; i < selectedImages.length; i += batchSize) {
        const batch = selectedImages.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (image) => {
            try {
              const formData = new FormData();
              formData.append('image', image.blob, image.filename);
              formData.append('title', image.filename.replace(/\.[^/.]+$/, ''));
              formData.append('gallery_id', collectionId);

              const response = await fetch(
                `${apiBase}/api/v1/galleries/${collectionId}/artworks`,
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

      // Trigger embedding generation
      try {
        await fetch(`${apiBase}/api/v1/galleries/${collectionId}/embeddings/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forceRegenerate: false }),
        });
      } catch (err) {
        console.error('Failed to trigger embedding generation:', err);
      }

      setCurrentStep('complete');
    } catch (err) {
      console.error('Processing failed:', err);
      setProgress((prev) => ({
        ...prev,
        errors: [...prev.errors, 'Processing failed'],
      }));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-sm">
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
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8 max-w-4xl">
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2">
            {(['upload', 'review', 'processing', 'complete'] as Step[]).map((step, index) => {
              const stepIndex = ['upload', 'review', 'processing', 'complete'].indexOf(currentStep);
              const isActive = step === currentStep;
              const isCompleted = index < stepIndex;

              return (
                <div key={step} className="flex items-center">
                  {index > 0 && (
                    <div
                      className={`w-16 h-0.5 ${
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
        </div>

        {/* Step Content */}
        <AnimatePresence mode="wait">
          {/* Step 1: Upload */}
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
                    Add Images
                  </CardTitle>
                  <CardDescription>
                    Drop a ZIP file or individual images to add to {collection.name}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ZipUploader onImagesReady={handleImagesReady} />
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 2: Review */}
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
                    Confirm Upload
                  </CardTitle>
                  <CardDescription>
                    Review and confirm to start uploading and generating embeddings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-neutral-800/50 rounded-lg">
                      <p className="text-sm text-neutral-400 mb-1">Collection</p>
                      <p className="text-lg font-semibold">{collection.name}</p>
                    </div>
                    <div className="p-4 bg-neutral-800/50 rounded-lg">
                      <p className="text-sm text-neutral-400 mb-1">Images to Add</p>
                      <p className="text-lg font-semibold text-primary-400">
                        {selectedImages.length}
                      </p>
                    </div>
                  </div>

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

                  <div className="p-4 bg-primary-500/10 border border-primary-500/30 rounded-lg">
                    <h4 className="font-medium text-primary-400 mb-2">What happens next:</h4>
                    <ul className="space-y-2 text-sm text-neutral-300">
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
                        Make images searchable immediately
                      </li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 3: Processing */}
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
                    Uploading...
                  </CardTitle>
                  <CardDescription>
                    Uploading images and generating embeddings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Progress</span>
                      <span>{progress.uploaded} / {progress.total}</span>
                    </div>
                    <div className="h-3 bg-neutral-800 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-primary-500 to-primary-400"
                        initial={{ width: 0 }}
                        animate={{
                          width: `${(progress.uploaded / progress.total) * 100}%`,
                        }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>

                  {progress.errors.length > 0 && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <p className="text-sm text-red-400">
                        {progress.errors.length} images failed to upload
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 4: Complete */}
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

                  <h2 className="text-2xl font-bold mb-2">Upload Complete!</h2>
                  <p className="text-neutral-400 mb-8">
                    {progress.uploaded} images added to {collection.name}
                    {progress.errors.length > 0 && `. ${progress.errors.length} failed.`}
                  </p>

                  {progress.errors.length > 0 && (
                    <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-left max-w-md mx-auto">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-4 w-4 text-yellow-400" />
                        <span className="text-sm font-medium text-yellow-400">
                          Failed uploads:
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
                      onClick={() => {
                        setCurrentStep('upload');
                        setSelectedImages([]);
                        setProgress({ total: 0, uploaded: 0, errors: [] });
                      }}
                    >
                      Upload More
                    </Button>
                    <Button onClick={() => navigate(`/collections/${collectionId}/search`)}>
                      Search Collection
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
              onClick={() => {
                if (currentStep === 'review') {
                  setCurrentStep('upload');
                } else {
                  navigate(`/collections/${collectionId}`);
                }
              }}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button
              onClick={() => {
                if (currentStep === 'upload') {
                  setCurrentStep('review');
                } else if (currentStep === 'review') {
                  startProcessing();
                }
              }}
              disabled={selectedImages.length === 0}
              className="gap-2"
            >
              {currentStep === 'review' ? (
                <>
                  <Sparkles className="h-4 w-4" />
                  Start Upload
                </>
              ) : (
                'Review & Confirm'
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
