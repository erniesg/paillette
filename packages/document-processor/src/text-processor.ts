import type { ExtractedDocument, DocumentMetadata, SupportedDocumentType } from './types';
import { DocumentProcessingError } from './types';

/**
 * Simple text processor for plain text files
 */
export class TextProcessor {
  async extract(buffer: ArrayBuffer, filename: string): Promise<ExtractedDocument> {
    try {
      const text = new TextDecoder('utf-8').decode(buffer);

      const metadata: DocumentMetadata = {
        filename,
        fileType: 'txt',
        size: buffer.byteLength,
        wordCount: this.countWords(text),
      };

      return {
        text,
        metadata,
        chunks: this.chunkText(text),
      };
    } catch (error) {
      throw new DocumentProcessingError(
        'Failed to process text document',
        'TEXT_PROCESSING_ERROR',
        error
      );
    }
  }

  /**
   * Chunk text into manageable segments for translation
   * Each chunk should be ~1000 words or less
   */
  private chunkText(text: string, maxWords: number = 1000): string[] {
    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];
    let currentChunk = '';
    let currentWordCount = 0;

    for (const paragraph of paragraphs) {
      const paragraphWords = this.countWords(paragraph);

      if (currentWordCount + paragraphWords > maxWords && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
        currentWordCount = paragraphWords;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        currentWordCount += paragraphWords;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  private countWords(text: string): number {
    return text.split(/\s+/).filter((word) => word.length > 0).length;
  }
}
