import { z } from 'zod';
import {
  PUBLIC_SEARCH_CONTRACT_VERSION,
  PUBLIC_SEARCH_SPOTLIGHT_SCHEMA_VERSION,
} from './public-search-core';

export * from './public-search-core';

const HexColourSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

export const PublicSearchSpotlightArtworkSchema = z
  .object({
    id: z.string().min(1),
    orgId: z.string().min(1),
    title: z.string().min(1),
    artist: z.string().min(1).optional(),
    year: z.number().int().optional(),
    imageUrl: z.string().url().nullable().optional(),
    thumbnailUrl: z.string().url().nullable().optional(),
    similarity: z.number().min(0).max(1),
    source: z
      .object({
        provider: z.literal('nga'),
        institution: z.string().min(1),
        recordId: z.string().min(1).optional(),
        url: z.string().url().optional(),
        accessionNumber: z.string().min(1).optional(),
        rights: z.string().min(1).optional(),
      })
      .strict(),
    palette: z
      .array(HexColourSchema)
      .max(32)
      .refine(
        (colours) =>
          new Set(colours.map((value) => value.toLowerCase())).size ===
          colours.length,
        {
          message: 'Spotlight palette colours must be unique',
        }
      ),
  })
  .strict()
  .refine((artwork) => Boolean(artwork.thumbnailUrl || artwork.imageUrl), {
    message: 'Spotlight artwork requires an image',
  });

export const PublicSearchSpotlightSuggestionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      'keyword',
      'occasion',
      'motif',
      'mood',
      'style',
      'medium',
      'metadata',
      'colour',
    ]),
    label: z.string().min(1),
    detail: z.string().min(1).optional(),
    dot: HexColourSchema,
    query: z.string().min(1),
    facet: z.enum(['artist', 'classification']).optional(),
    colourId: z.string().min(1).optional(),
    artworks: z.array(PublicSearchSpotlightArtworkSchema).length(4),
  })
  .strict()
  .refine(
    (suggestion) =>
      new Set(suggestion.artworks.map((artwork) => artwork.id)).size ===
      suggestion.artworks.length,
    { message: 'Spotlight artwork IDs must be unique per suggestion' }
  );

export const PublicSearchSpotlightBundleSchema = z
  .object({
    schemaVersion: z.literal(PUBLIC_SEARCH_SPOTLIGHT_SCHEMA_VERSION),
    contractVersion: z.literal(PUBLIC_SEARCH_CONTRACT_VERSION),
    corpusVersion: z.string().min(1),
    provider: z.literal('nga'),
    generatedAt: z.string().datetime(),
    requestDefaults: z
      .object({
        topK: z.literal(30),
        minScore: z.literal(0.2),
      })
      .strict(),
    suggestions: z.array(PublicSearchSpotlightSuggestionSchema).min(1),
  })
  .strict()
  .refine(
    (bundle) =>
      new Set(bundle.suggestions.map((suggestion) => suggestion.id)).size ===
      bundle.suggestions.length,
    { message: 'Spotlight suggestion IDs must be unique' }
  );

export type PublicSearchSpotlightArtwork = z.infer<
  typeof PublicSearchSpotlightArtworkSchema
>;
export type PublicSearchSpotlightSuggestion = z.infer<
  typeof PublicSearchSpotlightSuggestionSchema
>;
export type PublicSearchSpotlightBundle = z.infer<
  typeof PublicSearchSpotlightBundleSchema
>;
