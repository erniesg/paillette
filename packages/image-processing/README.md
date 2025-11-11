# Image Processing Package

Automated frame detection and removal for artwork images using edge detection algorithms.

## Overview

This package provides tools to automatically detect and remove decorative frames from photographed artwork. It uses edge detection with a Sobel operator to identify frame boundaries and crops images to show only the artwork.

## Features

- **Automatic Frame Detection**: Uses edge detection and statistical analysis to find frame boundaries
- **Confidence Scoring**: Provides confidence scores (0.0-1.0) for detection quality
- **Multiple Frame Types**: Handles black, white, and colored frames
- **Frame Thickness**: Works with thin (<5%) and thick (>15%) frames
- **Quality Preservation**: Maintains image quality during cropping
- **Format Support**: Handles JPEG, PNG, and other common formats
- **Cloudflare Workers Compatible**: Uses Sharp for image processing (works in Workers)

## Installation

```bash
pnpm add @paillette/image-processing
```

## Usage

### Basic Frame Removal

```typescript
import { FrameDetector } from '@paillette/image-processing';

const detector = new FrameDetector();

// Load image
const imageBuffer = await readFile('artwork.jpg');

// Remove frame
const result = await detector.removeFrame(imageBuffer);

if (result.success && result.processedImageBuffer) {
  console.log(`Frame removed with ${result.detection.confidence} confidence`);
  await writeFile('artwork_processed.jpg', result.processedImageBuffer);
} else {
  console.log('No frame detected or processing failed');
}
```

### Frame Detection Only

```typescript
const detection = await detector.detectFrame(imageBuffer);

console.log('Has frame:', detection.hasFrame);
console.log('Confidence:', detection.confidence);
console.log('Bounding box:', detection.boundingBox);
console.log('Original dimensions:', detection.originalDimensions);
console.log('Cropped dimensions:', detection.croppedDimensions);
```

### Custom Configuration

```typescript
import { FrameDetector, type FrameDetectionConfig } from '@paillette/image-processing';

const config: FrameDetectionConfig = {
  cannyLowThreshold: 30,      // Edge detection sensitivity (lower = more sensitive)
  cannyHighThreshold: 100,     // Edge detection threshold (lower = more edges)
  minConfidence: 0.7,          // Minimum confidence to accept result
  minCropPercentage: 0.4,      // Minimum 40% of image must remain
  maxCropPercentage: 0.9,      // Maximum 90% can be cropped
  blurKernelSize: 7,           // Blur to reduce noise (higher = more blur)
};

const detector = new FrameDetector(config);
```

## Algorithm Details

### Edge Detection

1. Convert image to grayscale
2. Apply Gaussian blur to reduce noise
3. Use Sobel operator for gradient calculation
4. Threshold gradients to create edge map

### Frame Boundary Detection

1. Calculate edge density for each row and column
2. Use statistical analysis (median, max) to find thresholds
3. Detect sustained high-density regions (frame edges)
4. Find drop-off points (transition to artwork)

### Confidence Scoring

The confidence score is calculated based on:

1. **Crop Ratio** (0-40%):
   - Optimal: 50-85% retained (clear frame detected)
   - Heavy cropping: 30-50% retained (thick frame)
   - Light cropping: 85-95% retained (thin frame)
   - Too little: >95% retained (likely no frame)

2. **Centering** (0-20%):
   - Well-centered crop indicates proper frame detection
   - Off-center suggests false detection

3. **Aspect Ratio Preservation** (0-10%):
   - Similar aspect ratio means frame was uniform
   - Changed aspect ratio may indicate incorrect detection

**Typical Confidence Ranges:**
- 0.8-1.0: Excellent detection, high certainty
- 0.6-0.8: Good detection, acceptable result
- 0.4-0.6: Moderate detection, may need review
- <0.4: Low confidence, manual review recommended

## Test Coverage

The package includes comprehensive tests covering:

- Simple black/white frames
- Colored frames
- Thin and thick frames
- Frameless artwork
- Complex artwork patterns
- Ambiguous cases
- JPEG and PNG formats
- Grayscale images
- Various image sizes
- Edge cases and error handling

**Current Test Results:**
- 20 total tests
- 15 passing (75%)
- 5 failing (edge cases being refined)

## Performance

- Small images (500x500): ~50-100ms
- Medium images (1200x800): ~100-200ms
- Large images (2000x1500): ~200-500ms
- Very large images (4000x3000): <5 seconds

## Limitations

1. **Rectangular Frames Only**: Currently only detects rectangular frames
2. **Uniform Frames**: Works best with solid-colored, uniform frames
3. **Centered Artwork**: Assumes artwork is roughly centered
4. **No Deep Learning**: Uses traditional CV methods (faster but less accurate than AI)

## Future Improvements

- [ ] Support for non-rectangular frames (ovals, irregular shapes)
- [ ] AI-based detection using SAM or similar models
- [ ] Multi-stage detection for complex frames
- [ ] Perspective correction for angled photographs
- [ ] Shadow removal at frame edges
- [ ] Better handling of matted artworks (artwork within frame with mat)

## API Integration

This package is designed to work with the Paillette API for async processing:

```typescript
// Queue artwork for processing
await fetch('/api/v1/artworks/:id/process-frame', {
  method: 'POST',
  headers: { Authorization: 'Bearer token' }
});

// Check processing status
const status = await fetch('/api/v1/artworks/:id/processing-status');
const data = await status.json();
console.log(data.status); // 'pending' | 'processing' | 'completed' | 'failed'
```

## License

Part of the Paillette project.
