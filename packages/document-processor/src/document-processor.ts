import type { ExtractedDocument, SupportedDocumentType } from './types';
import { DocumentProcessingError } from './types';
import { TextProcessor } from './text-processor';
import { PDFProcessor } from './pdf-processor';
import { DOCXProcessor } from './docx-processor';

/**
 * Main document processor that routes to appropriate handler
 */
export class DocumentProcessor {
  private textProcessor: TextProcessor;
  private pdfProcessor: PDFProcessor;
  private docxProcessor: DOCXProcessor;

  constructor() {
    this.textProcessor = new TextProcessor();
    this.pdfProcessor = new PDFProcessor();
    this.docxProcessor = new DOCXProcessor();
  }

  /**
   * Extract text from document based on file type
   */
  async extract(
    buffer: ArrayBuffer,
    filename: string,
    fileType?: SupportedDocumentType
  ): Promise<ExtractedDocument> {
    const detectedType = fileType || this.detectFileType(filename);

    switch (detectedType) {
      case 'txt':
        return this.textProcessor.extract(buffer, filename);

      case 'pdf':
        return this.pdfProcessor.extract(buffer, filename);

      case 'docx':
        return this.docxProcessor.extract(buffer, filename);

      default:
        throw new DocumentProcessingError(
          `Unsupported file type: ${detectedType}`,
          'UNSUPPORTED_FILE_TYPE'
        );
    }
  }

  /**
   * Detect file type from filename extension
   */
  private detectFileType(filename: string): SupportedDocumentType {
    const ext = filename.split('.').pop()?.toLowerCase();

    switch (ext) {
      case 'txt':
        return 'txt';
      case 'pdf':
        return 'pdf';
      case 'docx':
      case 'doc':
        return 'docx';
      default:
        throw new DocumentProcessingError(
          `Cannot detect file type from extension: ${ext}`,
          'UNKNOWN_FILE_TYPE'
        );
    }
  }

  /**
   * Get list of supported file types
   */
  getSupportedTypes(): SupportedDocumentType[] {
    return ['txt', 'pdf', 'docx'];
  }

  /**
   * Check if file type is supported
   */
  isSupported(filename: string): boolean {
    try {
      this.detectFileType(filename);
      return true;
    } catch {
      return false;
    }
  }
}
