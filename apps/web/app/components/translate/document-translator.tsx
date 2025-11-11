/**
 * Document translation component
 */

import { useState, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, Download, Loader2, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import type { Language } from '~/types';
import { apiClient } from '~/lib/api';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { LanguageSelector } from './language-selector';
import { cn } from '~/lib/utils';

const ACCEPTED_FILE_TYPES = [
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const ACCEPTED_FILE_EXTENSIONS = ['.txt', '.pdf', '.docx'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface UploadedFile {
  file: File;
  jobId?: string;
}

export function DocumentTranslator() {
  const [sourceLang, setSourceLang] = useState<Language>('en');
  const [targetLang, setTargetLang] = useState<Language>('zh');
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      return await apiClient.translateDocument(file, sourceLang, targetLang);
    },
    onSuccess: (data) => {
      setUploadedFile((prev) => (prev ? { ...prev, jobId: data.jobId } : null));
    },
  });

  // Poll job status
  const { data: jobStatus, refetch } = useQuery({
    queryKey: ['translation-job', uploadedFile?.jobId],
    queryFn: () => {
      if (!uploadedFile?.jobId) return null;
      return apiClient.getTranslationJobStatus(uploadedFile.jobId);
    },
    enabled: !!uploadedFile?.jobId,
    refetchInterval: (data) => {
      // Stop polling when completed or failed
      if (!data || data.status === 'completed' || data.status === 'failed') {
        return false;
      }
      return 2000; // Poll every 2 seconds
    },
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      validateAndSetFile(files[0]);
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file: File) => {
    // Validate file type
    if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
      alert(
        `Unsupported file type. Please upload ${ACCEPTED_FILE_EXTENSIONS.join(', ')} files only.`
      );
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      alert(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit.`);
      return;
    }

    setUploadedFile({ file });
    uploadMutation.reset();
  };

  const handleUpload = () => {
    if (!uploadedFile?.file) return;
    if (sourceLang === targetLang) {
      alert('Source and target languages must be different');
      return;
    }
    uploadMutation.mutate(uploadedFile.file);
  };

  const handleDownload = () => {
    if (!uploadedFile?.jobId) return;
    const downloadUrl = apiClient.downloadTranslatedDocument(uploadedFile.jobId);
    window.open(downloadUrl, '_blank');
  };

  const handleReset = () => {
    setUploadedFile(null);
    uploadMutation.reset();
  };

  const getStatusIcon = () => {
    if (!jobStatus) return null;

    switch (jobStatus.status) {
      case 'queued':
        return <AlertCircle className="h-5 w-5 text-yellow-500" />;
      case 'processing':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
    }
  };

  const getStatusMessage = () => {
    if (!jobStatus) return null;

    switch (jobStatus.status) {
      case 'queued':
        return 'Your document is queued for translation...';
      case 'processing':
        return 'Translating your document...';
      case 'completed':
        return 'Translation complete! Download your file below.';
      case 'failed':
        return `Translation failed: ${jobStatus.error || 'Unknown error'}`;
    }
  };

  return (
    <div className="space-y-6">
      {/* Language selectors */}
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <LanguageSelector
              label="Source Language"
              value={sourceLang}
              onChange={setSourceLang}
              disabled={!!uploadedFile?.jobId}
            />

            <LanguageSelector
              label="Target Language"
              value={targetLang}
              onChange={setTargetLang}
              disabled={!!uploadedFile?.jobId}
            />
          </div>
        </CardContent>
      </Card>

      {/* File upload area */}
      <Card>
        <CardHeader>
          <CardTitle>Upload Document</CardTitle>
          <CardDescription>
            Supported formats: TXT, PDF, DOCX (max {MAX_FILE_SIZE / 1024 / 1024}MB)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!uploadedFile ? (
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={cn(
                'relative border-2 border-dashed rounded-lg p-12 text-center transition-all duration-200',
                dragActive
                  ? 'border-primary-500 bg-primary-500/10'
                  : 'border-neutral-700 bg-neutral-900/50 hover:border-neutral-600'
              )}
            >
              <input
                type="file"
                onChange={handleFileInput}
                accept={ACCEPTED_FILE_EXTENSIONS.join(',')}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />

              <Upload className="h-12 w-12 mx-auto mb-4 text-neutral-500" />

              <h3 className="text-lg font-semibold mb-2">Drop your file here</h3>
              <p className="text-sm text-neutral-400 mb-4">
                or click to browse from your computer
              </p>
              <p className="text-xs text-neutral-500">
                {ACCEPTED_FILE_EXTENSIONS.join(', ')} up to {MAX_FILE_SIZE / 1024 / 1024}MB
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* File preview */}
              <div className="flex items-center gap-4 p-4 rounded-lg border border-neutral-800 bg-neutral-900/50">
                <FileText className="h-10 w-10 text-primary-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{uploadedFile.file.name}</p>
                  <p className="text-sm text-neutral-400">
                    {(uploadedFile.file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                {!uploadedFile.jobId && (
                  <Button variant="ghost" size="sm" onClick={handleReset}>
                    Remove
                  </Button>
                )}
              </div>

              {/* Upload button */}
              {!uploadedFile.jobId && (
                <Button
                  onClick={handleUpload}
                  disabled={uploadMutation.isPending || sourceLang === targetLang}
                  className="w-full"
                >
                  {uploadMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Upload & Translate
                    </>
                  )}
                </Button>
              )}

              {/* Upload error */}
              {uploadMutation.isError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-lg bg-red-500/10 border border-red-500/50"
                >
                  <div className="flex items-center gap-2 text-red-400">
                    <XCircle className="h-5 w-5" />
                    <span>
                      Upload failed: {uploadMutation.error?.message || 'Unknown error'}
                    </span>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job status */}
      <AnimatePresence>
        {jobStatus && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {getStatusIcon()}
                  Translation Status
                </CardTitle>
                <CardDescription>{getStatusMessage()}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Progress indicator */}
                  {(jobStatus.status === 'queued' || jobStatus.status === 'processing') && (
                    <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
                      <motion.div
                        initial={{ width: '0%' }}
                        animate={{ width: '100%' }}
                        transition={{
                          duration: 30,
                          ease: 'linear',
                        }}
                        className="h-full bg-gradient-accent"
                      />
                    </div>
                  )}

                  {/* Download button */}
                  {jobStatus.status === 'completed' && jobStatus.downloadUrl && (
                    <div className="space-y-3">
                      <Button onClick={handleDownload} className="w-full">
                        <Download className="h-4 w-4" />
                        Download Translated Document
                      </Button>

                      {jobStatus.cost && (
                        <p className="text-sm text-neutral-400 text-center">
                          Translation cost: ${jobStatus.cost.toFixed(4)}
                        </p>
                      )}

                      <Button variant="outline" onClick={handleReset} className="w-full">
                        Translate Another Document
                      </Button>
                    </div>
                  )}

                  {/* Retry button */}
                  {jobStatus.status === 'failed' && (
                    <Button variant="outline" onClick={handleReset} className="w-full">
                      Try Again
                    </Button>
                  )}

                  {/* Job details */}
                  <div className="text-sm text-neutral-400 space-y-1">
                    <p>
                      <span className="font-medium">Job ID:</span> {jobStatus.jobId}
                    </p>
                    <p>
                      <span className="font-medium">Languages:</span> {jobStatus.sourceLang} →{' '}
                      {jobStatus.targetLang}
                    </p>
                    <p>
                      <span className="font-medium">Created:</span>{' '}
                      {new Date(jobStatus.createdAt).toLocaleString()}
                    </p>
                    {jobStatus.completedAt && (
                      <p>
                        <span className="font-medium">Completed:</span>{' '}
                        {new Date(jobStatus.completedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
