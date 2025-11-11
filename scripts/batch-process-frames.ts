#!/usr/bin/env node
/**
 * Batch Frame Removal Script
 * Process all artworks in a gallery to remove frames
 */

import { parseArgs } from 'node:util';

interface BatchProcessOptions {
  apiUrl: string;
  galleryId: string;
  apiKey?: string;
  forceReprocess?: boolean;
  dryRun?: boolean;
}

/**
 * Main batch processing function
 */
async function batchProcessFrames(options: BatchProcessOptions): Promise<void> {
  const { apiUrl, galleryId, apiKey, forceReprocess = false, dryRun = false } = options;

  console.log('Frame Removal Batch Processing');
  console.log('==============================');
  console.log(`Gallery ID: ${galleryId}`);
  console.log(`API URL: ${apiUrl}`);
  console.log(`Force Reprocess: ${forceReprocess}`);
  console.log(`Dry Run: ${dryRun}`);
  console.log('');

  try {
    // Step 1: Get processing statistics
    console.log('Fetching gallery statistics...');
    const statsResponse = await fetch(
      `${apiUrl}/galleries/${galleryId}/processing-stats`,
      {
        headers: {
          ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
        },
      }
    );

    if (!statsResponse.ok) {
      throw new Error(`Failed to fetch stats: ${statsResponse.statusText}`);
    }

    const statsData = await statsResponse.json();

    if (!statsData.success) {
      throw new Error(`API error: ${JSON.stringify(statsData.error)}`);
    }

    const stats = statsData.data;
    console.log('\nCurrent Statistics:');
    console.log(`  Total artworks: ${stats.total}`);
    console.log(`  Already processed: ${stats.has_processed_image}`);
    console.log(`  Pending: ${stats.pending}`);
    console.log(`  Processing: ${stats.processing}`);
    console.log(`  Completed: ${stats.completed}`);
    console.log(`  Failed: ${stats.failed}`);
    console.log(`  Average confidence: ${stats.avg_confidence?.toFixed(2) || 'N/A'}`);
    console.log('');

    // Calculate how many will be processed
    const toProcess = forceReprocess
      ? stats.total
      : stats.total - stats.completed;

    console.log(`Artworks to process: ${toProcess}`);

    if (toProcess === 0) {
      console.log('No artworks to process. Exiting.');
      return;
    }

    if (dryRun) {
      console.log('\nDRY RUN - No artworks will be processed.');
      return;
    }

    // Step 2: Trigger batch processing
    console.log('\nQueueing artworks for processing...');
    const batchResponse = await fetch(
      `${apiUrl}/galleries/${galleryId}/artworks/batch-process-frames`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
        },
        body: JSON.stringify({
          galleryId,
          forceReprocess,
        }),
      }
    );

    if (!batchResponse.ok) {
      throw new Error(`Failed to queue batch: ${batchResponse.statusText}`);
    }

    const batchData = await batchResponse.json();

    if (!batchData.success) {
      throw new Error(`API error: ${JSON.stringify(batchData.error)}`);
    }

    console.log(`\n✅ Successfully queued ${batchData.data.queuedCount} artworks`);

    // Step 3: Monitor progress
    console.log('\nMonitoring progress (press Ctrl+C to exit)...');
    await monitorProgress(apiUrl, galleryId, apiKey);
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Monitor processing progress
 */
async function monitorProgress(
  apiUrl: string,
  galleryId: string,
  apiKey?: string
): Promise<void> {
  const startTime = Date.now();

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Poll every 5 seconds

    try {
      const response = await fetch(
        `${apiUrl}/galleries/${galleryId}/processing-stats`,
        {
          headers: {
            ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
          },
        }
      );

      if (!response.ok) {
        console.error('Failed to fetch progress');
        continue;
      }

      const data = await response.json();
      const stats = data.data;

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const progress =
        stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(1) : 0;

      console.log(
        `[${elapsed}s] Progress: ${stats.completed}/${stats.total} (${progress}%) | ` +
          `Pending: ${stats.pending} | Processing: ${stats.processing} | Failed: ${stats.failed}`
      );

      // Check if done
      if (stats.pending === 0 && stats.processing === 0) {
        console.log('\n✅ All artworks processed!');
        console.log(`Total completed: ${stats.completed}`);
        console.log(`Total failed: ${stats.failed}`);
        console.log(`Average confidence: ${stats.avg_confidence?.toFixed(2) || 'N/A'}`);
        break;
      }
    } catch (error) {
      console.error('Error monitoring progress:', error);
    }
  }
}

/**
 * CLI Entry Point
 */
async function main() {
  const { values } = parseArgs({
    options: {
      apiUrl: {
        type: 'string',
        short: 'u',
        default: 'http://localhost:8787/api/v1',
      },
      galleryId: {
        type: 'string',
        short: 'g',
      },
      apiKey: {
        type: 'string',
        short: 'k',
      },
      forceReprocess: {
        type: 'boolean',
        short: 'f',
        default: false,
      },
      dryRun: {
        type: 'boolean',
        short: 'd',
        default: false,
      },
      help: {
        type: 'boolean',
        short: 'h',
      },
    },
  });

  if (values.help || !values.galleryId) {
    console.log(`
Frame Removal Batch Processing Script

Usage:
  node batch-process-frames.ts --galleryId <gallery-id> [options]

Options:
  -g, --galleryId <id>       Gallery ID to process (required)
  -u, --apiUrl <url>         API URL (default: http://localhost:8787/api/v1)
  -k, --apiKey <key>         API key for authentication
  -f, --forceReprocess       Reprocess already completed artworks
  -d, --dryRun               Show what would be processed without actually processing
  -h, --help                 Show this help message

Examples:
  # Process all unprocessed artworks in a gallery
  node batch-process-frames.ts --galleryId abc-123

  # Dry run to see how many would be processed
  node batch-process-frames.ts --galleryId abc-123 --dryRun

  # Force reprocess all artworks
  node batch-process-frames.ts --galleryId abc-123 --forceReprocess

  # Use custom API URL with authentication
  node batch-process-frames.ts --galleryId abc-123 \\
    --apiUrl https://api.paillette.art/v1 \\
    --apiKey your-api-key
    `);
    process.exit(0);
  }

  await batchProcessFrames({
    apiUrl: values.apiUrl!,
    galleryId: values.galleryId!,
    apiKey: values.apiKey,
    forceReprocess: values.forceReprocess,
    dryRun: values.dryRun,
  });
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { batchProcessFrames };
