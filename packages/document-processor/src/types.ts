import { z } from 'zod';

export const SupportedDocumentTypeSchema = z.enum(['docx', 'pdf', 'txt']);
export type SupportedDocumentType = z.infer<typeof SupportedDocumentTypeSchema>;

export interface DocumentMetadata {
  filename: string;
  fileType: SupportedDocumentType;
  size: number;
  pageCount?: number;
  wordCount?: number;
  language?: string;
}

export interface ExtractedDocument {
  text: string;
  metadata: DocumentMetadata;
  chunks?: string[]; // For large documents
  preserveFormatting?: boolean;
}

export interface ProcessedDocument {
  originalText: string;
  translatedText: string;
  metadata: DocumentMetadata;
  documentBuffer?: ArrayBuffer; // For reconstructed documents
}

export class DocumentProcessingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'DocumentProcessingError';
  }
}
