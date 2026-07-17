import { describe, expect, it } from 'vitest';
import {
  buildDocsMarkdown,
  canCreateDocsApiKey,
  docsNavGroups,
  endpointDocs,
  getDocsApiKeyHint,
  isInlineTryItEndpoint,
  getQuickSearchEndpoint,
  getQuickSearchInitialValues,
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
    expect(
      endpointDocs.find((doc) => doc.id === 'extract')?.endpoint.title
    ).toBe('Extract image');
  });

  it('uses the same extract image label in the Markdown export', () => {
    const markdown = buildDocsMarkdown('https://api.example.test/api/v1');

    expect(markdown).toContain('### POST /api/v1/extract - Extract image');
    expect(markdown).toContain('Extract image');
    expect(markdown).not.toContain(
      '### POST /extract\n\nCreate a batch /extract job'
    );
  });

  it('puts the runnable search workflow before authentication', () => {
    const startItems = docsNavGroups.find(
      (group) => group.title === 'Start'
    )?.items;

    expect(startItems?.map(({ id }) => id)).toEqual([
      'overview',
      'try-search',
      'authentication',
      'field-sources',
    ]);
    expect(getQuickSearchEndpoint().path).toBe('/orgs/ngs/search/text');
    expect(getQuickSearchInitialValues()).toMatchObject({
      query: 'batik textile pattern',
      topK: '10',
      minScore: '0.2',
    });
  });

  it('allows a replacement docs key when an existing key is only a masked prefix', () => {
    expect(canCreateDocsApiKey(false)).toBe(true);
    expect(canCreateDocsApiKey(true)).toBe(false);
    expect(getDocsApiKeyHint(true)).toContain('cannot be recovered');
    expect(getDocsApiKeyHint(true)).toContain('Create a new key');
  });

  it('puts an interactive request and response console on text search', () => {
    expect(isInlineTryItEndpoint('search-text')).toBe(true);
    expect(isInlineTryItEndpoint('search-image')).toBe(false);
  });
});
