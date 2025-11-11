/**
 * Gallery Upload Manager Page
 * Route: /galleries/:galleryId/upload
 */

import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData, useNavigate } from '@remix-run/react';
import { CSVUploader } from '../components/upload/csv-uploader';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const { galleryId } = params;

  if (!galleryId) {
    throw new Response('Gallery ID is required', { status: 400 });
  }

  return json({
    galleryId,
  });
};

export default function GalleryUpload() {
  const { galleryId } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const handleUploadComplete = (result: any) => {
    console.log('Upload complete:', result);
    // Could show a toast notification here
  };

  const handleUploadError = (error: Error) => {
    console.error('Upload error:', error);
    // Could show an error toast here
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold">Upload Artwork Metadata</h1>
          <Button
            onClick={() => navigate(`/galleries/${galleryId}`)}
            className="bg-gray-500"
          >
            Back to Gallery
          </Button>
        </div>
        <p className="text-gray-600">
          Upload a CSV file to batch create or update artwork metadata for your
          gallery
        </p>
      </div>

      {/* Instructions */}
      <Card className="p-6 mb-6 bg-blue-50 border-blue-200">
        <h2 className="text-lg font-semibold mb-3">How it works</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
          <li>
            Download the CSV template or prepare your own CSV with the required
            columns
          </li>
          <li>
            Fill in the artwork metadata. Use <code>artwork_id</code> to update
            existing artworks
          </li>
          <li>
            Upload the CSV file - it will be validated automatically
          </li>
          <li>
            Review the validation results and fix any errors if needed
          </li>
          <li>
            Click "Upload Metadata" to process the batch
          </li>
        </ol>

        <div className="mt-4 p-3 bg-white rounded border border-blue-300">
          <h3 className="font-semibold text-sm mb-2">CSV Columns:</h3>
          <div className="text-xs text-gray-600 space-y-1">
            <p>
              <strong>artwork_id</strong> (optional): Leave empty to create new
              artworks, or provide ID to update existing
            </p>
            <p>
              <strong>title</strong> (required): Artwork title
            </p>
            <p>
              <strong>artist</strong> (optional): Artist name
            </p>
            <p>
              <strong>year</strong> (optional): Year created (number)
            </p>
            <p>
              <strong>medium</strong> (optional): Medium/materials
            </p>
            <p>
              <strong>dimensions_height, dimensions_width, dimensions_depth</strong>{' '}
              (optional): Measurements
            </p>
            <p>
              <strong>dimensions_unit</strong> (optional): cm, in, or m
            </p>
            <p>
              <strong>description</strong> (optional): Artwork description
            </p>
            <p>
              <strong>provenance</strong> (optional): Provenance information
            </p>
            <p>
              <strong>image_filename</strong> (optional): Match to existing
              image by filename
            </p>
          </div>
        </div>
      </Card>

      {/* CSV Uploader Component */}
      <CSVUploader
        galleryId={galleryId}
        onUploadComplete={handleUploadComplete}
        onUploadError={handleUploadError}
      />

      {/* Additional Info */}
      <Card className="p-6 mt-6 bg-gray-50">
        <h2 className="text-lg font-semibold mb-3">Performance</h2>
        <div className="text-sm text-gray-700 space-y-2">
          <p>
            <strong>Batch Processing:</strong> Our system can process up to
            1,000 rows in under 10 seconds.
          </p>
          <p>
            <strong>Updates vs Creates:</strong> Existing artworks are matched
            by artwork_id or image_filename.
          </p>
          <p>
            <strong>Error Handling:</strong> Invalid rows are skipped and
            reported. Valid rows are still processed.
          </p>
        </div>
      </Card>
    </div>
  );
}
