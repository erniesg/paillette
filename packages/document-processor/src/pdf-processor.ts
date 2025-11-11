import type { ExtractedDocument, DocumentMetadata } from './types';
import { DocumentProcessingError } from './types';

/**
 * PDF processor
 * Note: For Cloudflare Workers, PDF processing is limited.
 * This is a placeholder that extracts text only (no formatting preservation)
 * For production, consider using an external service like pdf.js or Adobe PDF Services API
 */
export class PDFProcessor {
  async extract(buffer: ArrayBuffer, filename: string): Promise<ExtractedDocument> {
    throw new DocumentProcessingError(
      'PDF processing not yet implemented. Consider using an external service like Adobe PDF Services API or converting to plain text first.',
      'PDF_NOT_IMPLEMENTED'
    );

    // TODO: Implement PDF text extraction
    // Options:
    // 1. Use pdf.js (if compatible with Workers)
    // 2. Use external API (Adobe, AWS Textract)
    // 3. Convert PDF to images and use OCR
    //
    // For now, return error to user
  }

  /**
   * Placeholder for future implementation
   */
  private async extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
    // This would use pdf.js or similar library
    throw new Error('Not implemented');
  }
}
