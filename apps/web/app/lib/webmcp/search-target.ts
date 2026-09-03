/**
 * Which collection a search should actually run against.
 *
 * `/try` exists so a visitor can build a collection from their own zip, and
 * while they are looking at it "show me stormy seascapes" means *that*
 * collection — not the published NGA catalogue the tools default to. Reading
 * the live index job off the shared store is what makes the agent's search and
 * the human's grid the same collection.
 *
 * An explicitly named public collection always wins, so an agent can still
 * reach the published catalogue from `/try` by naming it.
 *
 * Lives in its own module because both the tool surface and the redeal loop
 * need it, and the redeal loop must not import the tool surface.
 */

import {
  DEFAULT_PUBLIC_COLLECTION_ID,
  getPublicCollection,
} from './collections';
import { getWebMcpState } from './store';

export type SearchTarget =
  | { kind: 'public'; collectionId: string }
  | {
      kind: 'indexed';
      jobId: string;
      collectionId: string;
      collectionName: string;
    };

export const resolveSearchTarget = (collection: unknown): SearchTarget => {
  const named = getPublicCollection(collection);
  if (named) return { kind: 'public', collectionId: named.id };

  const job = getWebMcpState().indexJob;
  if (job) {
    return {
      kind: 'indexed',
      jobId: job.jobId,
      collectionId: job.collectionId,
      collectionName: job.collectionName,
    };
  }

  return { kind: 'public', collectionId: DEFAULT_PUBLIC_COLLECTION_ID };
};

export const searchPathFor = (collectionId: string) =>
  getPublicCollection(collectionId)?.searchPath ?? '/nga/search';
