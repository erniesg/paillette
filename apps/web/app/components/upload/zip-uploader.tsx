import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import JSZip from 'jszip';
import {
  Upload,
  FileArchive,
  Image as ImageIcon,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';

export interface ImagePreview {
  id: string;
  filename: string;
  url: string;
  blob: Blob;
  size: number;
  type: string;
  selected: boolean;
  error?: string;
}

interface ZipUploaderProps {
  onImagesReady: (images: ImagePreview[]) => void;
  maxImages?: number;
  maxFileSize?: number; // in bytes
}

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff'];
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop();
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff'].includes(ext || '');
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function ZipUploader({
  onImagesReady,
  maxImages = 500,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
}: ZipUploaderProps) {
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Process ZIP file
  const processZipFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setProcessingStatus('Reading ZIP file...');
    setError(null);

    try {
      const zip = await JSZip.loadAsync(file);
      const imageFiles: { name: string; file: JSZip.JSZipObject }[] = [];

      // Collect all image files
      zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir && isImageFile(relativePath)) {
          // Skip hidden files and __MACOSX folder
          if (!relativePath.startsWith('__MACOSX') && !relativePath.startsWith('.')) {
            imageFiles.push({ name: relativePath, file: zipEntry });
          }
        }
      });

      if (imageFiles.length === 0) {
        setError('No image files found in ZIP');
        setIsProcessing(false);
        return;
      }

      if (imageFiles.length > maxImages) {
        setError(`ZIP contains ${imageFiles.length} images. Maximum is ${maxImages}.`);
        setIsProcessing(false);
        return;
      }

      setProcessingStatus(`Found ${imageFiles.length} images. Extracting...`);

      const newImages: ImagePreview[] = [];
      let processed = 0;

      for (const { name, file: zipEntry } of imageFiles) {
        try {
          const blob = await zipEntry.async('blob');

          // Check file size
          if (blob.size > maxFileSize) {
            newImages.push({
              id: generateId(),
              filename: name.split('/').pop() || name,
              url: '',
              blob,
              size: blob.size,
              type: blob.type || 'image/unknown',
              selected: false,
              error: `File too large (${(blob.size / 1024 / 1024).toFixed(1)}MB)`,
            });
            continue;
          }

          // Create object URL for preview
          const url = URL.createObjectURL(blob);

          newImages.push({
            id: generateId(),
            filename: name.split('/').pop() || name,
            url,
            blob,
            size: blob.size,
            type: blob.type || 'image/jpeg',
            selected: true,
          });

          processed++;
          setProcessingStatus(`Extracting: ${processed}/${imageFiles.length}`);
        } catch (err) {
          console.error(`Error extracting ${name}:`, err);
          newImages.push({
            id: generateId(),
            filename: name.split('/').pop() || name,
            url: '',
            blob: new Blob(),
            size: 0,
            type: 'unknown',
            selected: false,
            error: 'Failed to extract',
          });
        }
      }

      setImages(newImages);
      onImagesReady(newImages.filter(img => img.selected && !img.error));
    } catch (err) {
      console.error('Error processing ZIP:', err);
      setError('Failed to process ZIP file. Make sure it\'s a valid ZIP archive.');
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  }, [maxImages, maxFileSize, onImagesReady]);

  // Process individual image files
  const processImageFiles = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    setProcessingStatus(`Processing ${files.length} images...`);
    setError(null);

    const newImages: ImagePreview[] = [];

    for (const file of files) {
      if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
        newImages.push({
          id: generateId(),
          filename: file.name,
          url: '',
          blob: file,
          size: file.size,
          type: file.type,
          selected: false,
          error: 'Unsupported format',
        });
        continue;
      }

      if (file.size > maxFileSize) {
        newImages.push({
          id: generateId(),
          filename: file.name,
          url: '',
          blob: file,
          size: file.size,
          type: file.type,
          selected: false,
          error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
        });
        continue;
      }

      const url = URL.createObjectURL(file);
      newImages.push({
        id: generateId(),
        filename: file.name,
        url,
        blob: file,
        size: file.size,
        type: file.type,
        selected: true,
      });
    }

    // Append to existing images
    const combinedImages = [...images, ...newImages];

    if (combinedImages.length > maxImages) {
      setError(`Cannot add more images. Maximum is ${maxImages}.`);
      setIsProcessing(false);
      return;
    }

    setImages(combinedImages);
    onImagesReady(combinedImages.filter(img => img.selected && !img.error));
    setIsProcessing(false);
    setProcessingStatus('');
  }, [images, maxImages, maxFileSize, onImagesReady]);

  // Handle file drop
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    // Check if it's a ZIP file
    const zipFile = acceptedFiles.find(f =>
      f.type === 'application/zip' ||
      f.type === 'application/x-zip-compressed' ||
      f.name.toLowerCase().endsWith('.zip')
    );

    if (zipFile) {
      await processZipFile(zipFile);
    } else {
      // Process as individual images
      await processImageFiles(acceptedFiles);
    }
  }, [processZipFile, processImageFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/zip': ['.zip'],
      'application/x-zip-compressed': ['.zip'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/gif': ['.gif'],
      'image/tiff': ['.tif', '.tiff'],
    },
    multiple: true,
    disabled: isProcessing,
  });

  // Toggle image selection
  const toggleImageSelection = (id: string) => {
    const updatedImages = images.map(img =>
      img.id === id && !img.error ? { ...img, selected: !img.selected } : img
    );
    setImages(updatedImages);
    onImagesReady(updatedImages.filter(img => img.selected && !img.error));
  };

  // Select/deselect all
  const toggleSelectAll = () => {
    const validImages = images.filter(img => !img.error);
    const allSelected = validImages.every(img => img.selected);
    const updatedImages = images.map(img =>
      !img.error ? { ...img, selected: !allSelected } : img
    );
    setImages(updatedImages);
    onImagesReady(updatedImages.filter(img => img.selected && !img.error));
  };

  // Remove image
  const removeImage = (id: string) => {
    const img = images.find(i => i.id === id);
    if (img?.url) {
      URL.revokeObjectURL(img.url);
    }
    const updatedImages = images.filter(i => i.id !== id);
    setImages(updatedImages);
    onImagesReady(updatedImages.filter(img => img.selected && !img.error));
  };

  // Clear all
  const clearAll = () => {
    images.forEach(img => {
      if (img.url) URL.revokeObjectURL(img.url);
    });
    setImages([]);
    onImagesReady([]);
    setError(null);
  };

  const selectedCount = images.filter(img => img.selected && !img.error).length;
  const errorCount = images.filter(img => img.error).length;

  return (
    <div className="space-y-6">
      {/* Drop Zone */}
      {images.length === 0 && (
        <div
          {...getRootProps()}
          className={`relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-200 ${
            isDragActive
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-neutral-700 hover:border-primary-500/50 hover:bg-neutral-800/30'
          } ${isProcessing ? 'pointer-events-none opacity-50' : ''}`}
        >
          <input {...getInputProps()} />

          {isProcessing ? (
            <div className="space-y-4">
              <Loader2 className="h-16 w-16 mx-auto text-primary-500 animate-spin" />
              <p className="text-lg text-neutral-300">{processingStatus}</p>
            </div>
          ) : (
            <>
              <div className="flex justify-center gap-4 mb-6">
                <div className="w-20 h-20 rounded-xl bg-neutral-800/50 flex items-center justify-center">
                  <FileArchive className="h-10 w-10 text-primary-400" />
                </div>
                <div className="w-20 h-20 rounded-xl bg-neutral-800/50 flex items-center justify-center">
                  <ImageIcon className="h-10 w-10 text-primary-400" />
                </div>
              </div>
              <p className="text-xl text-neutral-200 mb-2">
                {isDragActive ? 'Drop files here...' : 'Drag & drop your files'}
              </p>
              <p className="text-neutral-400 mb-4">
                Drop a <span className="text-primary-400 font-medium">ZIP file</span> or individual{' '}
                <span className="text-primary-400 font-medium">images</span>
              </p>
              <p className="text-sm text-neutral-500">
                Supported: JPEG, PNG, WebP, GIF, TIFF (max {maxFileSize / 1024 / 1024}MB each)
              </p>
            </>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <Card className="border-red-500/50 bg-red-500/10">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
            <p className="text-red-400">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setError(null)}
              className="ml-auto"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Preview Grid */}
      {images.length > 0 && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-semibold">
                Preview ({selectedCount} selected)
              </h3>
              {errorCount > 0 && (
                <span className="text-sm text-red-400">
                  {errorCount} with errors
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                {images.filter(img => !img.error).every(img => img.selected)
                  ? 'Deselect All'
                  : 'Select All'}
              </Button>
              <Button variant="outline" size="sm" onClick={clearAll}>
                Clear All
              </Button>
              <div {...getRootProps()} className="inline-block">
                <input {...getInputProps()} />
                <Button variant="outline" size="sm" className="gap-1">
                  <Upload className="h-4 w-4" />
                  Add More
                </Button>
              </div>
            </div>
          </div>

          {/* Image Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            <AnimatePresence mode="popLayout">
              {images.map((image) => (
                <motion.div
                  key={image.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  layout
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    image.error
                      ? 'border-red-500/50 opacity-50'
                      : image.selected
                      ? 'border-primary-500 ring-2 ring-primary-500/30'
                      : 'border-transparent opacity-50'
                  }`}
                >
                  {/* Image Preview */}
                  {image.url ? (
                    <img
                      src={image.url}
                      alt={image.filename}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => !image.error && toggleImageSelection(image.id)}
                    />
                  ) : (
                    <div
                      className="w-full h-full bg-neutral-800 flex items-center justify-center cursor-pointer"
                      onClick={() => !image.error && toggleImageSelection(image.id)}
                    >
                      <ImageIcon className="h-8 w-8 text-neutral-600" />
                    </div>
                  )}

                  {/* Selection Indicator */}
                  {!image.error && (
                    <div
                      className={`absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer ${
                        image.selected
                          ? 'bg-primary-500 border-primary-500'
                          : 'bg-neutral-900/80 border-neutral-500'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleImageSelection(image.id);
                      }}
                    >
                      {image.selected && <CheckCircle2 className="h-3 w-3 text-white" />}
                    </div>
                  )}

                  {/* Error Badge */}
                  {image.error && (
                    <div className="absolute inset-0 bg-neutral-900/80 flex items-center justify-center p-2">
                      <span className="text-xs text-red-400 text-center">{image.error}</span>
                    </div>
                  )}

                  {/* Remove Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(image.id);
                    }}
                    className="absolute top-2 right-2 w-5 h-5 rounded-full bg-neutral-900/80 hover:bg-red-500 flex items-center justify-center transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>

                  {/* Filename */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <p className="text-[10px] text-white truncate">{image.filename}</p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Summary */}
          <Card className="border-neutral-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-6">
                  <div>
                    <span className="text-neutral-400">Total:</span>{' '}
                    <span className="font-medium">{images.length}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400">Selected:</span>{' '}
                    <span className="font-medium text-primary-400">{selectedCount}</span>
                  </div>
                  {errorCount > 0 && (
                    <div>
                      <span className="text-neutral-400">Errors:</span>{' '}
                      <span className="font-medium text-red-400">{errorCount}</span>
                    </div>
                  )}
                </div>
                <div className="text-neutral-400">
                  Total size:{' '}
                  <span className="font-medium">
                    {(
                      images
                        .filter(img => img.selected && !img.error)
                        .reduce((sum, img) => sum + img.size, 0) /
                      1024 /
                      1024
                    ).toFixed(1)}
                    MB
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
