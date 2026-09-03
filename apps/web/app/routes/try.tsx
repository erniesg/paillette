/**
 * `/try` — the anonymous entry point.
 *
 * A visitor with no account turns a zip of images into a semantically
 * searchable collection and searches it, without leaving this page. It drives
 * exactly the same client as the WebMCP `index_zip` tool
 * (`~/lib/indexing-client`) against exactly the same anonymous routes, so the
 * human path and the agent path are the same path — and whatever is indexed
 * here is immediately visible to an agent through `get_view_context`.
 *
 * The demo collections come from `/samples/manifest.json`, not from a constant
 * in this file: whoever adds a dataset appends an entry there and it shows up
 * in the picker.
 *
 * Everything runs client-side: there is no loader, because there is nothing
 * for a server to know before the visitor picks a file.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@remix-run/react';
import type { MetaFunction } from '@remix-run/cloudflare';
import { Logo } from '~/components/ui/logo';
import { Button } from '~/components/ui/button';
import { ImageWithFallback } from '~/components/artwork/image-with-fallback';
import { NoImagePlaceholder } from '~/components/artwork/no-image-placeholder';
import {
  getIndexStatus,
  indexZip,
  parseIndexZip,
  searchIndexedCollection,
  type IndexJobHandle,
  type IndexStatus,
} from '~/lib/indexing-client';
import {
  preflightArchive,
  type ArchivePreflight,
} from '~/lib/archive-preflight';
import {
  estimateMinutes,
  formatDuration,
  loadDemoArchives,
  SECONDS_PER_IMAGE,
  type DemoArchive,
} from '~/lib/demo-archives';
import { INDEX_CAPS, megabytes } from '~/lib/webmcp/caps';
import { toIndexedArtwork } from '~/lib/webmcp/indexed-artwork';
import { getCollectionSuggestions } from '~/lib/webmcp/collection-suggestions';
import { rememberArtworks } from '~/lib/webmcp/artwork-index';
import { toAgentArtworkSummary } from '~/lib/webmcp/artwork-summary';
import { setHumanResults, setIndexJob } from '~/lib/webmcp/store';
import type { ArtworkSearchResult } from '~/types';

export const meta: MetaFunction = () => [
  { title: 'Try Paillette — index your own images' },
  {
    name: 'description',
    content:
      'Turn a zip of images into a searchable collection. No account, no setup.',
  },
];

const POLL_INTERVAL_MS = 2000;
const SEARCH_TOP_K = 24;

/**
 * Measured on staging, not guessed: the job reports `searchable: true` the
 * instant the first batch is embedded, but Vectorize needs roughly another 15
 * seconds before a query returns those vectors (0 hits at t+1.9s and t+7.6s
 * after a batch of 4, 1 hit at t+14.6s). A search run inside that window comes
 * back empty, which reads as "this is broken" unless the page says otherwise.
 */
const VECTOR_LAG_SECONDS = 15;
/** Consecutive status-poll failures before the page admits it has lost the job. */
const MAX_POLL_FAILURES = 5;

/** Anonymous indexing writes only here; the server enforces it. */
const INDEX_SANDBOX_ORG = 'webmcp-index';

type Phase = 'idle' | 'reading' | 'indexing' | 'ready' | 'failed';

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const timestampName = (prefix: string) =>
  `${prefix} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

const filenameOf = (path: string) => path.split('/').pop() || 'archive.zip';

export default function TryPaillette() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [archives, setArchives] = useState<DemoArchive[] | null>(null);
  const [preflight, setPreflight] = useState<ArchivePreflight | null>(null);
  const [collectionName, setCollectionName] = useState<string>('');
  const [job, setJob] = useState<IndexJobHandle | null>(null);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  /** Server-confirmed count from the upload itself; fresher than the poll. */
  const [uploaded, setUploaded] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ArtworkSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState('');

  /** Set when an empty result is better explained by index lag than by the query. */
  const [searchLagged, setSearchLagged] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * When an empty search stops being explained by propagation lag. Infinite
   * while a job is still embedding; once it finishes, the last image still
   * needs roughly VECTOR_LAG_SECONDS before Vectorize will return it — and
   * that is exactly when a visitor, watching the page stop moving, types their
   * first query.
   */
  const lagUntilRef = useRef<number>(Number.POSITIVE_INFINITY);
  /** Consecutive failed status polls, so a dead poll surfaces instead of spinning. */
  const pollFailuresRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // The picker is manifest-driven; a missing or broken manifest falls back to
  // the archive bundled with the app rather than leaving the page with no
  // call to action.
  useEffect(() => {
    let live = true;
    void loadDemoArchives().then((loaded) => {
      if (live) setArchives(loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  // Leaving the page cancels the upload rather than letting it run on
  // invisibly. Nothing already embedded is lost — the job keeps whatever it
  // finished, and its status still reports the truth.
  useEffect(
    () => () => {
      stopPolling();
      abortRef.current?.abort();
    },
    [stopPolling]
  );

  // A 100-image archive takes minutes. Counting the seconds out loud is the
  // difference between "working" and "hung".
  useEffect(() => {
    if (startedAt === null) return;
    if (status?.state === 'complete' || status?.state === 'failed') return;
    const tick = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => clearInterval(tick);
  }, [startedAt, status?.state]);

  const beginJob = useCallback(
    async (file: File, name: string) => {
      abortRef.current?.abort();
      stopPolling();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase('reading');
      setError(null);
      setSearchError(null);
      setResults(null);
      setStatus(null);
      setJob(null);
      setPreflight(null);
      setUploaded(0);
      setElapsed(0);
      setStartedAt(null);
      setSearchLagged(false);
      lagUntilRef.current = Number.POSITIVE_INFINITY;
      pollFailuresRef.current = 0;
      setCollectionName(name);
      setStage('Reading the archive…');

      let plan: ArchivePreflight;
      try {
        // Read the directory first so the caps can be stated before anything
        // is uploaded. Only entry names and sizes are touched here; images are
        // decompressed later, batch by batch, by the indexing client.
        plan = preflightArchive(await parseIndexZip(file));
      } catch (cause) {
        setPhase('failed');
        setError(
          `That file could not be read as a zip archive: ${describeError(cause)}`
        );
        return;
      }

      setPreflight(plan);
      if (plan.blocker) {
        setPhase('failed');
        setError(plan.blocker);
        return;
      }

      setStage(
        `Uploading and embedding ${plan.willIndex} images — about ${estimateMinutes(plan.willIndex)} min…`
      );
      let handle: IndexJobHandle;
      try {
        handle = await indexZip(file, {
          collectionName: name,
          orgId: INDEX_SANDBOX_ORG,
          signal: controller.signal,
          // Each batch the server confirms moves the bar immediately, rather
          // than waiting for the next poll to notice.
          onProgress: ({ processed }) =>
            setUploaded(Number.isFinite(processed) ? processed : 0),
        });
      } catch (cause) {
        setPhase('failed');
        setError(describeError(cause));
        return;
      }

      setJob(handle);
      setPhase('indexing');
      setStartedAt(Date.now());
      // Put it on the shared canvas: an agent asking `get_view_context` now
      // learns that the human has a collection of their own, and can poll or
      // search it without being told the jobId.
      setIndexJob({
        jobId: handle.jobId,
        collectionId: handle.collectionId,
        collectionName: name,
        origin: 'human',
        source: 'zip',
        at: Date.now(),
      });

      const poll = async () => {
        let next: IndexStatus;
        try {
          next = await getIndexStatus(handle.jobId, {
            signal: controller.signal,
          });
        } catch {
          // A dropped poll is not a dropped job; the next tick re-reads it.
          // A poll that keeps failing is a different thing, though: without
          // this the page polls forever with both picker buttons disabled and
          // nothing on screen saying anything is wrong.
          pollFailuresRef.current += 1;
          if (pollFailuresRef.current >= MAX_POLL_FAILURES) {
            stopPolling();
            setPhase('failed');
            setError(
              `Lost contact with the indexing job after ${MAX_POLL_FAILURES} attempts. Images already embedded are still in the collection; reload to start again.`
            );
          }
          return;
        }
        pollFailuresRef.current = 0;
        setStatus(next);
        if (next.searchable ?? next.processed > 0) {
          setPhase((current) => (current === 'indexing' ? 'ready' : current));
        }
        if (next.state === 'complete' || next.state === 'failed') {
          stopPolling();
          lagUntilRef.current = Date.now() + VECTOR_LAG_SECONDS * 1000;
          if (next.processed === 0) {
            setPhase('failed');
            setError(
              next.notice ||
                'The job finished without indexing anything. See the per-file errors below.'
            );
          }
        }
      };

      pollRef.current = setInterval(() => {
        void poll();
      }, POLL_INTERVAL_MS);
      void poll();
    },
    [stopPolling]
  );

  const startDemo = useCallback(
    async (archive: DemoArchive) => {
      setPhase('reading');
      setError(null);
      setStage(`Fetching ${archive.name}…`);
      try {
        const response = await fetch(archive.path);
        if (!response.ok) {
          throw new Error(`the archive returned HTTP ${response.status}`);
        }
        // arrayBuffer rather than blob: one fewer copy, and it sidesteps the
        // Blob-into-File interop that differs between engines.
        const file = new File(
          [await response.arrayBuffer()],
          filenameOf(archive.path),
          { type: 'application/zip' }
        );
        await beginJob(file, `${archive.source} — ${archive.name}`);
      } catch (cause) {
        setPhase('failed');
        setError(
          `Could not load ${archive.name}: ${describeError(cause)}. Upload your own zip instead.`
        );
      }
    },
    [beginJob]
  );

  const onPickFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so picking the same file twice still fires a change.
      event.target.value = '';
      if (!file) return;
      void beginJob(file, timestampName(file.name.replace(/\.zip$/i, '')));
    },
    [beginJob]
  );

  const runSearch = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || !job) return;
      setSearching(true);
      setSearchError(null);
      try {
        const response = await searchIndexedCollection(job.jobId, trimmed, {
          topK: SEARCH_TOP_K,
        });
        const artworks = response.results.map((result) =>
          toIndexedArtwork(result, response.collectionId, collectionName)
        );
        setResults(artworks);
        setLastQuery(trimmed);
        // Decided here, not at render: whether an empty result is lag or a
        // genuine miss depends on when the search ran, not on when React
        // happens to re-render.
        setSearchLagged(
          artworks.length === 0 && Date.now() < lagUntilRef.current
        );
        // The same two calls the public-search observer makes for the NGA
        // grid, so `get_view_context` reports these results as what the human
        // is looking at, and `show_artwork` can resolve their ids.
        rememberArtworks(artworks);
        setHumanResults({
          origin: 'human',
          label: `search “${trimmed}” in ${collectionName} (${artworks.length} results)`,
          items: artworks.map(toAgentArtworkSummary),
          at: Date.now(),
        });
      } catch (cause) {
        setSearchError(describeError(cause));
      } finally {
        setSearching(false);
      }
    },
    [collectionName, job]
  );

  const busy = phase === 'reading' || phase === 'indexing';
  const total = status?.total ?? preflight?.willIndex ?? 0;
  const processed = Math.max(status?.processed ?? 0, uploaded);
  const percent =
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const running = status?.state !== 'complete' && status?.state !== 'failed';

  // Searchable the moment the server has embedded anything. Both counts here
  // are server-confirmed — `uploaded` comes from the /items reply, `status`
  // from the poll — and the poll only lands every couple of seconds. Gating on
  // `state: "complete"` instead would hold a 100-image visitor at a disabled
  // search box for six minutes with results already sitting in the index.
  const canSearch =
    job !== null && (status?.searchable === true || processed > 0);

  // Only a completed job has a fixed suggestion bundle — see get_index_status,
  // the same field an agent reads for the same collection.
  const suggestions = getCollectionSuggestions(status);

  // Rate measured on this job once it has produced anything; the published
  // estimate until then. Never shown as a countdown to zero — it is a guess
  // and reads as one.
  const remainingLabel = (() => {
    if (!running || total <= processed) return null;
    const left = total - processed;
    const seconds =
      processed > 0 && elapsed > 0
        ? Math.round((elapsed / processed) * left)
        : left * SECONDS_PER_IMAGE;
    return `about ${formatDuration(seconds)} left`;
  })();

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-sm">
        <div className="container mx-auto flex items-center justify-between px-6 py-4">
          <Link to="/">
            <Logo size="md" />
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              to="/collections/nga/search"
              className="text-neutral-400 transition-colors hover:text-white"
            >
              Search the NGA collection
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-6 py-12">
        <h1 className="font-display text-4xl font-bold lg:text-5xl">
          Turn a pile of images into a searchable collection
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-neutral-400">
          Pick a demo collection or drop in your own zip. Every image is
          embedded in the same vector space Paillette uses for the National
          Gallery of Art, and you can search it in plain language while the rest
          is still indexing. No account, nothing to install. An agent in this
          browser can do all of it too — and can see whatever you index here.
        </p>

        {/* Caps up front, not after a failed upload. One flat paragraph: the
            limits have to read as a single sentence to a screen reader and to
            anyone scanning the page, not as a label plus a fragment. */}
        <p className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-400">
          Anonymous limits: up to {INDEX_CAPS.maxImagesPerJob} images per
          archive,{' '}
          {megabytes(INDEX_CAPS.maxImageBytes)} MB per image,{' '}
          {megabytes(INDEX_CAPS.maxJobBytes)} MB per job,{' '}
          {INDEX_CAPS.maxJobsPerHour} jobs per hour from one address. Supported
          types: {INDEX_CAPS.imageTypes.join(', ')}. A CSV sidecar named in the
          archive becomes catalogue metadata; without one, titles come from
          filenames. Everything lands in a shared public sandbox — do not upload
          anything private.
        </p>

        <section className="mt-8" aria-labelledby="try-picker-heading">
          <h2
            id="try-picker-heading"
            className="text-sm uppercase tracking-wide text-neutral-500"
          >
            Choose a collection to index
          </h2>

          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {(archives ?? []).map((archive) => (
              <li
                key={archive.id}
                className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-900/60 p-5"
              >
                <h3 className="font-display text-xl font-semibold">
                  {archive.name}
                </h3>
                <p className="mt-1 text-sm text-neutral-400">
                  {archive.source}
                </p>
                <p className="mt-3 text-sm text-neutral-500">
                  {archive.imageCount > 0
                    ? `${archive.imageCount} images · about ${estimateMinutes(archive.imageCount)} min to index`
                    : 'Size unknown until it is read'}
                  {' · '}
                  {archive.hasMetadata
                    ? 'with catalogue metadata'
                    : 'no metadata sidecar'}
                </p>
                {archive.note && (
                  <p className="mt-2 text-sm text-neutral-500">{archive.note}</p>
                )}
                <p className="mt-2 text-xs text-neutral-600">
                  {archive.licence}
                  {archive.bytes ? ` · ${megabytes(archive.bytes)} MB` : ''}
                </p>
                <div className="mt-4">
                  <Button
                    onClick={() => void startDemo(archive)}
                    disabled={busy}
                  >
                    Index {archive.name}
                  </Button>
                </div>
              </li>
            ))}

            <li className="flex flex-col rounded-xl border border-dashed border-neutral-700 bg-neutral-900/30 p-5">
              <h3 className="font-display text-xl font-semibold">
                Your own images
              </h3>
              <p className="mt-1 text-sm text-neutral-400">
                A zip from your machine
              </p>
              <p className="mt-3 text-sm text-neutral-500">
                Up to {INDEX_CAPS.maxImagesPerJob} images. Anything the archive
                cannot index is listed rather than dropped silently.
              </p>
              <div className="mt-4 grow content-end">
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                >
                  Upload your own zip
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                className="hidden"
                aria-label="Upload a zip archive of images"
                onChange={onPickFile}
              />
            </li>
          </ul>
        </section>

        {busy && (
          <p className="mt-6 text-sm text-primary-300" role="status">
            {stage}
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200"
          >
            {error}
          </div>
        )}

        {preflight && preflight.warnings.length > 0 && (
          <ul className="mt-6 space-y-2 rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
            {preflight.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}

        {job && (
          <section className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl font-semibold">
                {collectionName}
              </h2>
              <span className="font-mono text-xs text-neutral-500">
                job {job.jobId}
              </span>
            </div>

            <div className="mt-4">
              <div className="flex justify-between text-sm text-neutral-400">
                <span>
                  {processed} of {total} images indexed
                  {status?.state ? ` · ${status.state}` : ''}
                </span>
                <span>{percent}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full bg-gradient-accent transition-all duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                {formatDuration(elapsed)} elapsed
                {remainingLabel ? ` · ${remainingLabel}` : ''}
                {running
                  ? ' · this page keeps uploading as long as it stays open'
                  : ''}
              </p>
            </div>

            {status?.notice && (
              <p className="mt-4 text-sm text-amber-200">{status.notice}</p>
            )}

            {status && status.errors.length > 0 && (
              <details className="mt-4 text-sm text-neutral-400">
                <summary className="cursor-pointer text-neutral-300">
                  {status.errors.length} file
                  {status.errors.length === 1 ? '' : 's'} skipped or failed
                </summary>
                <ul className="mt-2 space-y-1">
                  {status.errors.map((entry) => (
                    <li key={`${entry.file}:${entry.message}`}>
                      <span className="font-mono text-neutral-300">
                        {entry.file}
                      </span>{' '}
                      — {entry.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {(phase === 'ready' || phase === 'indexing') && (
              <form
                className="mt-6 flex flex-col gap-3 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runSearch(query);
                }}
              >
                <label htmlFor="try-search" className="sr-only">
                  Search this collection
                </label>
                <input
                  id="try-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search it — “a landscape with trees”, “a portrait”…"
                  disabled={!canSearch}
                  className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2 text-white placeholder:text-neutral-600 focus:border-primary-500 focus:outline-none disabled:opacity-50"
                />
                <Button
                  type="submit"
                  disabled={!canSearch || searching || !query.trim()}
                >
                  {searching ? 'Searching…' : 'Search'}
                </Button>
              </form>
            )}

            {suggestions && suggestions.suggestions.length > 0 && (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-neutral-500">
                  Suggested searches —{' '}
                  {suggestions.source === 'metadata'
                    ? 'grounded in this collection’s catalogue metadata'
                    : suggestions.source === 'filenames'
                      ? 'no metadata sidecar, so these come from filenames instead'
                      : 'no metadata sidecar and no readable filenames, so these search the images themselves'}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {suggestions.suggestions.map((suggestion) => (
                    <li key={suggestion.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setQuery(suggestion.query);
                          void runSearch(suggestion.query);
                        }}
                        disabled={!canSearch || searching}
                        className="rounded-full border border-neutral-700 bg-neutral-900/60 px-3 py-1 text-sm text-neutral-200 transition-colors hover:border-primary-500 hover:text-white disabled:opacity-50"
                      >
                        {suggestion.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!canSearch && running && (
              <p className="mt-2 text-sm text-neutral-500">
                Search opens as soon as the first image is embedded — you do not
                have to wait for the whole archive.
              </p>
            )}

            {canSearch && running && (
              <p className="mt-2 text-sm text-neutral-500">
                Searchable now. An image takes roughly another{' '}
                {VECTOR_LAG_SECONDS}s after it is embedded before the vector
                index will return it, so an early search comes back thin — run
                it again as the count climbs.
              </p>
            )}

            {searchError && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200"
              >
                {searchError}
              </div>
            )}
          </section>
        )}

        {results && (
          <section className="mt-8">
            <h3 className="mb-4 text-sm uppercase tracking-wide text-neutral-500">
              {results.length} result{results.length === 1 ? '' : 's'} for “
              {lastQuery}”
            </h3>
            {results.length === 0 ? (
              <p className="text-neutral-400">
                {searchLagged
                  ? running
                    ? `Nothing back yet — an image becomes queryable about ${VECTOR_LAG_SECONDS}s after it is embedded, and ${processed} of ${total} are in so far. Search again in a moment.`
                    : `Nothing back yet — all ${processed} images are embedded, but the vector index needs about ${VECTOR_LAG_SECONDS}s after the last one before it will return them. Search again in a moment.`
                  : 'Nothing matched. Try a broader description — the index is only as large as the archive you sent.'}
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {results.map((artwork) => (
                  <li
                    key={artwork.id}
                    className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60"
                  >
                    <div className="flex aspect-square items-center justify-center bg-neutral-950">
                      <ImageWithFallback
                        src={artwork.thumbnailUrl || artwork.imageUrl}
                        alt={artwork.title || 'Indexed image'}
                        className="h-full w-full object-contain"
                        fallback={
                          <NoImagePlaceholder className="h-full w-full bg-transparent text-neutral-700" />
                        }
                      />
                    </div>
                    <div className="p-3">
                      <p className="truncate text-sm font-medium text-white">
                        {artwork.title || 'Untitled'}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {(artwork.similarity * 100).toFixed(1)}% match
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
