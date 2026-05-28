import { describe, expect, it } from 'vitest';
import {
  buildDocsMarkdown,
  docsNavGroups,
  endpointDocs,
} from '../../routes/docs.api';

describe('API docs labels', () => {
  it('uses verb-object labels for tool-like endpoints', () => {
    const translationItem = docsNavGroups
      .find((group) => group.title === 'Translation')
      ?.items.find((item) => item.id === 'translate-text');
    const extractItem = docsNavGroups
      .find((group) => group.title === 'Tools')
      ?.items.find((item) => item.id === 'extract');

    expect(translationItem?.label).toBe('translate text');
    expect(extractItem?.label).toBe('extract image');
    expect(endpointDocs.find((doc) => doc.id === 'extract')?.endpoint.title).toBe(
      'Extract image'
    );
  });

  it('uses the same extract image label in the Markdown export', () => {
    const markdown = buildDocsMarkdown('https://api.example.test/api/v1');

    expect(markdown).toContain('### POST /api/v1/extract - Extract image');
    expect(markdown).toContain('Extract image');
    expect(markdown).not.toContain('### POST /extract\n\nCreate a batch /extract job');
  });
});
