/**
 * CSV Uploader Component
 * Handles CSV file upload with drag-and-drop, validation, and progress tracking
 */

import { useState, useCallback } from 'react';
import { apiClient } from '../../lib/api';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

interface CSVUploaderProps {
  galleryId: string;
  onUploadComplete?: (result: any) => void;
  onUploadError?: (error: Error) => void;
}

interface ValidationResult {
  valid: boolean;
  stats: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
  };
  errors: Array<{
    row: number;
    column: string;
    message: string;
    value: any;
  }>;
  sample: any[];
  file_info: {
    name: string;
    size: number;
    type: string;
  };
}

export function CSVUploader({
  galleryId,
  onUploadComplete,
  onUploadError,
}: CSVUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);
  const [uploadResult, setUploadResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const csvFile = files.find(
      (f) => f.name.endsWith('.csv') || f.type === 'text/csv'
    );

    if (csvFile) {
      handleFileSelect(csvFile);
    } else {
      setError('Please drop a CSV file');
    }
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setValidationResult(null);
    setUploadResult(null);

    // Auto-validate on file select
    setIsValidating(true);
    try {
      const result = await apiClient.validateMetadata(selectedFile);
      setValidationResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const result = await apiClient.uploadMetadata(galleryId, file);
      setUploadResult(result);
      onUploadComplete?.(result);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Upload failed';
      setError(errorMessage);
      onUploadError?.(
        err instanceof Error ? err : new Error('Upload failed')
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setValidationResult(null);
    setUploadResult(null);
    setError(null);
  };

  const downloadTemplate = () => {
    const templateUrl = apiClient.downloadTemplate();
    window.location.href = templateUrl;
  };

  return (
    <div className="space-y-4">
      {/* Upload Success */}
      {uploadResult && (
        <Card className="p-6 border-green-200 bg-green-50">
          <h3 className="text-lg font-semibold text-green-900 mb-2">
            Upload Complete!
          </h3>
          <div className="space-y-2 text-sm text-green-800">
            <p>
              <strong>Created:</strong> {uploadResult.result.stats.created}{' '}
              artworks
            </p>
            <p>
              <strong>Updated:</strong> {uploadResult.result.stats.updated}{' '}
              artworks
            </p>
            {uploadResult.result.stats.failed > 0 && (
              <p className="text-red-600">
                <strong>Failed:</strong> {uploadResult.result.stats.failed}{' '}
                rows
              </p>
            )}
            <Button onClick={handleReset} className="mt-4">
              Upload Another File
            </Button>
          </div>
        </Card>
      )}

      {/* Error Display */}
      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-800">{error}</p>
        </Card>
      )}

      {!uploadResult && (
        <>
          {/* File Drop Zone */}
          <Card
            className={`p-8 border-2 border-dashed transition-colors ${
              isDragOver
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 bg-gray-50'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="text-center space-y-4">
              <div className="text-4xl">📊</div>
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  Upload CSV Metadata
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Drag and drop your CSV file here, or click to browse
                </p>
              </div>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileInputChange}
                className="hidden"
                id="csv-file-input"
              />
              <label htmlFor="csv-file-input" className="inline-block">
                <Button type="button" onClick={() => document.getElementById('csv-file-input')?.click()}>
                  Choose File
                </Button>
              </label>
              <div className="text-xs text-gray-500">
                <button
                  onClick={downloadTemplate}
                  className="text-blue-600 hover:underline"
                >
                  Download CSV Template
                </button>
              </div>
            </div>
          </Card>

          {/* Validation Results */}
          {isValidating && (
            <Card className="p-4">
              <p className="text-sm text-gray-600">Validating CSV...</p>
            </Card>
          )}

          {validationResult && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Validation Results</h3>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center p-3 bg-blue-50 rounded">
                  <div className="text-2xl font-bold text-blue-900">
                    {validationResult.stats.totalRows}
                  </div>
                  <div className="text-xs text-blue-700">Total Rows</div>
                </div>
                <div className="text-center p-3 bg-green-50 rounded">
                  <div className="text-2xl font-bold text-green-900">
                    {validationResult.stats.validRows}
                  </div>
                  <div className="text-xs text-green-700">Valid</div>
                </div>
                <div className="text-center p-3 bg-red-50 rounded">
                  <div className="text-2xl font-bold text-red-900">
                    {validationResult.stats.invalidRows}
                  </div>
                  <div className="text-xs text-red-700">Invalid</div>
                </div>
              </div>

              {/* Errors */}
              {validationResult.errors.length > 0 && (
                <div className="mb-4">
                  <h4 className="font-medium text-red-900 mb-2">
                    Validation Errors ({validationResult.errors.length})
                  </h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {validationResult.errors.slice(0, 10).map((err, idx) => (
                      <div key={idx} className="text-xs text-red-700 bg-red-50 p-2 rounded">
                        Row {err.row}, Column "{err.column}": {err.message}
                      </div>
                    ))}
                    {validationResult.errors.length > 10 && (
                      <p className="text-xs text-gray-600">
                        ... and {validationResult.errors.length - 10} more
                        errors
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Sample Preview */}
              {validationResult.sample.length > 0 && (
                <div className="mb-4">
                  <h4 className="font-medium mb-2">Sample Preview</h4>
                  <div className="text-xs text-gray-600 space-y-1">
                    {validationResult.sample.map((row: any, idx) => (
                      <div key={idx} className="p-2 bg-gray-50 rounded">
                        <strong>{row.title}</strong>
                        {row.artist && ` by ${row.artist}`}
                        {row.year && ` (${row.year})`}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Upload Button */}
              <div className="flex gap-2">
                <Button
                  onClick={handleUpload}
                  disabled={
                    isUploading ||
                    !validationResult.valid ||
                    validationResult.stats.validRows === 0
                  }
                  className="flex-1"
                >
                  {isUploading ? 'Uploading...' : 'Upload Metadata'}
                </Button>
                <Button onClick={handleReset} className="bg-gray-500">
                  Cancel
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
