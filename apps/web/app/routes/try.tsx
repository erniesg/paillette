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

/** Consecutive status-poll failures before the page admits it has lost the job. */
const MAX_POLL_FAILURES = 5;

/** Anonymous indexing writes only here; the server enforces it. */
const INDEX_SANDBOX_ORG = 'webmcp-index';

/**
 * How long an embedded image takes to become queryable is not a constant, so
 * the page used to print a fixed "~15s" that was wrong in the direction that
 * makes the product look broken — the visitor searches, gets nothing, and
 * concludes it failed. Measured on staging over a 30-image job, counting from
 * the moment the job reported `complete`: 1 of 30 queryable at +1s, still 1 at
 * +7s, 25 at +14s, all 30 at +34s. A visitor told to wait 15 seconds would
 * have searched a collection that was 5 images short.
 *
 * So it is measured instead. A broad probe search returns whatever the vector
 * index currently holds for this job — Vectorize returns the topK nearest
 * matches with no score floor, so the result count *is* the count of vectors
 * that have landed — and the page reports that climbing number. The count is
 * eventually consistent and can dip (1, then 0, then 1 in the run above), so
 * the high-water mark is what gets reported. The probe backs off and stops
 * when the count stops climbing; it is never shown as a countdown.
 */
const READINESS_PROBE_QUERY = 'artwork';
/** Server-side ceiling on `topK`; above this the count can only be a floor. */
const READINESS_PROBE_MAX_TOP_K = 50;
const READINESS_BACKOFF_MS = [
  1500, 2500, 4000, 6000, 9000, 12_000, 15_000, 15_000, 15_000, 15_000,
];
/** Probes with no climb before the count is called settled. */
const READINESS_SETTLE_ROUNDS = 3;

/**
 * The page holds the archive, so closing the tab ends the upload. What survives
 * is the job: whatever was embedded stays searchable. Remember it so a visitor
 * who navigated away lands back on their collection instead of an empty page.
 */
const RESUME_STORAGE_KEY = 'paillette.try.job.v1';

type StoredJob = {
  jobId: string;
  collectionId: string;
  collectionName: string;
  total: number;
  startedAt: number;
};

const readStoredJob = (): StoredJob | null => {
  try {
    const raw = window.localStorage.getItem(RESUME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredJob> | null;
    if (!parsed || typeof parsed.jobId !== 'string' || !parsed.jobId) return null;
    return {
      jobId: parsed.jobId,
      collectionId:
        typeof parsed.collectionId === 'string' ? parsed.collectionId : '',
      collectionName:
        typeof parsed.collectionName === 'string' && parsed.collectionName
          ? parsed.collectionName
          : 'Your collection',
      total: Number(parsed.total) || 0,
      startedAt: Number(parsed.startedAt) || 0,
    };
  } catch {
    // Private mode, a full quota, or a record from an older shape. Either way
    // there is nothing to restore and that must not break the page.
    return null;
  }
};

const writeStoredJob = (job: StoredJob) => {
  try {
    window.localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(job));
  } catch {
    // Not being able to remember the job only costs the resume path.
  }
};

const clearStoredJob = () => {
  try {
    window.localStorage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    // As above.
  }
};

type Phase = 'idle' | 'reading' | 'indexing' | 'ready' | 'failed';

/** What the probe knows so far. `expected` is what the server says it embedded. */
type Readiness = {
  count: number;
  expected: number;
  settled: boolean;
  /** `expected` is above the probe ceiling, so `count` can only be a floor. */
  capped: boolean;
};

/** A collection picked back up on load, and whether its upload was cut short. */
type ResumedJob = { interrupted: boolean };

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const timestampName = (prefix: string) =>
  `${prefix} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

const filenameOf = (path: string) => path.split('/').pop() || 'archive.zip';

const sentence = (clause: string) =>
  clause.charAt(0).toUpperCase() + clause.slice(1);

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

  /** Non-null once a collection is being measured; drives the probe loop. */
  const [probeFor, setProbeFor] = useState<{
    jobId: string;
    expected: number;
  } | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [resumed, setResumed] = useState<ResumedJob | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Consecutive failed status polls, so a dead poll surfaces instead of spinning. */
  const pollFailuresRef = useRef(0);
  /**
   * Set the moment the visitor starts a job. The restore below runs a network
   * round trip on mount, and must not overwrite a collection they have already
   * begun in the meantime.
   */
  const startedRef = useRef(false);

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

  // Pick a job back up after a reload or a navigation. The archive is gone —
  // it only ever lived in the tab that read it — so this restores the
  // collection, not the upload: what was embedded before the page went away is
  // still indexed, and still searchable.
  useEffect(() => {
    const stored = readStoredJob();
    if (!stored) return;

    let live = true;
    const controller = new AbortController();

    void (async () => {
      let restored: IndexStatus;
      try {
        restored = await getIndexStatus(stored.jobId, {
          signal: controller.signal,
        });
      } catch {
        // The job is gone or unreachable. Nothing to offer, so say nothing.
        clearStoredJob();
        return;
      }
      if (!live || startedRef.current) return;

      // One restore only: the upload cannot be picked up from here, so leaving
      // the record behind would re-offer the same stalled job forever.
      clearStoredJob();
      if (restored.processed <= 0) return;

      setJob({
        jobId: restored.jobId,
        collectionId: restored.collectionId || stored.collectionId,
      });
      setCollectionName(restored.collectionName || stored.collectionName);
      setStatus(restored);
      setPhase('ready');
      setResumed({ interrupted: restored.state !== 'complete' });
      setProbeFor({ jobId: restored.jobId, expected: restored.processed });
      // Back onto the shared canvas, so an agent asking `get_view_context`
      // sees the restored collection exactly as it saw the original.
      setIndexJob({
        jobId: restored.jobId,
        collectionId: restored.collectionId || stored.collectionId,
        collectionName: restored.collectionName || stored.collectionName,
        origin: 'human',
        source: 'zip',
        at: Date.now(),
      });
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, []);

  // Measure how much of the collection the vector index will actually return,
  // and keep measuring until the number stops climbing. Each probe is one
  // broad search, so the count is the truth rather than an estimate of it.
  useEffect(() => {
    if (!probeFor) return;
    const { jobId, expected } = probeFor;

    const limit = Math.min(Math.max(expected, 1), READINESS_PROBE_MAX_TOP_K);
    const capped = expected > READINESS_PROBE_MAX_TOP_K;
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let best = 0;
    let flat = 0;

    setReadiness({ count: 0, expected, settled: false, capped });

    const step = async (attempt: number) => {
      try {
        const response = await searchIndexedCollection(
          jobId,
          READINESS_PROBE_QUERY,
          { topK: limit, signal: controller.signal }
        );
        if (cancelled) return;
        const count = response.results.length;
        if (count > best) {
          best = count;
          flat = 0;
        } else {
          flat += 1;
        }
      } catch {
        // A failed probe is not evidence of anything; it just does not climb.
        if (cancelled) return;
        flat += 1;
      }

      const settled =
        best >= limit ||
        flat >= READINESS_SETTLE_ROUNDS ||
        attempt + 1 >= READINESS_BACKOFF_MS.length;
      setReadiness({ count: best, expected, settled, capped });
      if (settled) return;

      timer = setTimeout(
        () => void step(attempt + 1),
        READINESS_BACKOFF_MS[attempt]
      );
    };

    void step(0);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [probeFor]);

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
      startedRef.current = true;

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
      setResumed(null);
      setProbeFor(null);
      setReadiness(null);
      clearStoredJob();
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
      // Written before the first batch lands: if the visitor leaves a second
      // later, the job already exists and whatever it embeds is recoverable.
      writeStoredJob({
        jobId: handle.jobId,
        collectionId: handle.collectionId,
        collectionName: name,
        total: plan.willIndex,
        startedAt: Date.now(),
      });
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
          // A poll for a run the visitor has already replaced must not touch
          // the new run's state — not its failure count, and not its stored
          // record.
          if (abortRef.current !== controller) return;
          // A dropped poll is not a dropped job; the next tick re-reads it.
          // A poll that keeps failing is a different thing, though: without
          // this the page polls forever with both picker buttons disabled and
          // nothing on screen saying anything is wrong.
          pollFailuresRef.current += 1;
          if (pollFailuresRef.current >= MAX_POLL_FAILURES) {
            stopPolling();
            clearStoredJob();
            setPhase('failed');
            setError(
              `Lost contact with the indexing job after ${MAX_POLL_FAILURES} attempts. Images already embedded are still in the collection; reload to start again.`
            );
          }
          return;
        }
        if (abortRef.current !== controller) return;
        pollFailuresRef.current = 0;
        setStatus(next);
        if (next.searchable ?? next.processed > 0) {
          setPhase((current) => (current === 'indexing' ? 'ready' : current));
        }
        if (next.state === 'complete' || next.state === 'failed') {
          stopPolling();
          // The run is over, so there is nothing left to come back to.
          clearStoredJob();
          if (next.processed > 0) {
            // Functional, because the immediate poll and the interval poll can
            // both see `complete` — one measurement, not two racing loops.
            setProbeFor(
              (current) =>
                current ?? { jobId: handle.jobId, expected: next.processed }
            );
          }
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
      startedRef.current = true;
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

  /**
   * True only while this page is actively pushing batches. A restored job is
   * not uploading — the archive stayed in the tab that read it — even though
   * the server still has it filed as `running`, because nothing ever told the
   * server the client had gone.
   */
  const uploading =
    resumed === null &&
    status?.state !== 'complete' &&
    status?.state !== 'failed';

  const indexingInFlight = job !== null && phase !== 'failed' && uploading;

  /** Put the restored collection away and go back to the picker. */
  const dismissResumed = useCallback(() => {
    setResumed(null);
    setJob(null);
    setStatus(null);
    setResults(null);
    setProbeFor(null);
    setReadiness(null);
    setPhase('idle');
    clearStoredJob();
  }, []);

  // Closing the tab ends the upload — the archive only ever existed here — so
  // the browser gets to ask. Registered only while a job is actually in
  // flight: an idle page must never interrupt someone for nothing.
  useEffect(() => {
    if (!indexingInFlight) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome still wants the legacy assignment before it shows the prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [indexingInFlight]);

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
        // Decided here, not at render: whether an empty result is propagation
        // lag or a genuine miss depends on how much of the collection was
        // queryable when the search ran, not on when React re-renders.
        setSearchLagged(
          artworks.length === 0 &&
            (uploading || (readiness !== null && !readiness.settled))
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
    [collectionName, job, readiness, uploading]
  );

  const busy = phase === 'reading' || phase === 'indexing';
  const total = status?.total ?? preflight?.willIndex ?? 0;
  const processed = Math.max(status?.processed ?? 0, uploaded);
  const percent =
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

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
    if (!uploading || total <= processed) return null;
    const left = total - processed;
    const seconds =
      processed > 0 && elapsed > 0
        ? Math.round((elapsed / processed) * left)
        : left * SECONDS_PER_IMAGE;
    return `about ${formatDuration(seconds)} left`;
  })();

  // The measured count, phrased as a clause so the same words can carry a
  // status line and an explanation for an empty result set.
  const readinessClause = readiness
    ? `${
        readiness.capped && readiness.count >= READINESS_PROBE_MAX_TOP_K
          ? `at least ${readiness.count}`
          : readiness.count
      } of ${readiness.expected} image${readiness.expected === 1 ? '' : 's'} ${
        readiness.expected === 1 ? 'is' : 'are'
      } searchable${readiness.settled ? '' : ' so far'}`
    : null;

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
              {startedAt !== null && (
                <p className="mt-2 text-xs text-neutral-500">
                  {formatDuration(elapsed)} elapsed
                  {remainingLabel ? ` · ${remainingLabel}` : ''}
                  {uploading
                    ? ' · this page keeps uploading as long as it stays open'
                    : ''}
                </p>
              )}
            </div>

            {resumed && (
              <div
                role="status"
                className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-100"
              >
                {resumed.interrupted ? (
                  <>
                    <p>
                      Picked this collection back up. You left while it was
                      still indexing, and the upload runs in the page, so it
                      stopped there — {processed} of {total} images were indexed
                      before it did. Those {processed} are searchable below.
                    </p>
                    <p className="mt-2">
                      The rest were never uploaded and cannot be resumed from
                      here: this page no longer has the archive. Index it again
                      to get the whole set.
                    </p>
                  </>
                ) : (
                  <p>
                    Picked this collection back up — it finished indexing, and
                    all {processed} images are still here to search.
                  </p>
                )}
                <div className="mt-3">
                  <Button variant="outline" onClick={dismissResumed}>
                    Dismiss
                  </Button>
                </div>
              </div>
            )}

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

            {!canSearch && uploading && (
              <p className="mt-2 text-sm text-neutral-500">
                Search opens as soon as the first image is embedded — you do not
                have to wait for the whole archive.
              </p>
            )}

            {canSearch && uploading && (
              <p className="mt-2 text-sm text-neutral-500">
                Searchable now. The vector index picks each image up shortly
                after it is embedded, so an early search comes back thin — run
                it again as more land.
              </p>
            )}

            {/* Measured, not predicted: the count the vector index will
                actually return right now, climbing until it stops. */}
            {readinessClause && (
              <p className="mt-2 text-sm text-neutral-400" role="status">
                {!readiness?.settled
                  ? `${sentence(readinessClause)} — checking again…`
                  : readiness.capped &&
                      readiness.count >= READINESS_PROBE_MAX_TOP_K
                    ? // The probe hit its own ceiling, not the index's. Say
                      // which one stopped, rather than implying the index did.
                      `${sentence(readinessClause)} — this check reads ${READINESS_PROBE_MAX_TOP_K} at a time, so that is a floor and not a total.`
                    : readiness.count >= readiness.expected
                      ? `${sentence(readinessClause)}.`
                      : `${sentence(readinessClause)} — the count stopped climbing there.`}
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
                  ? readinessClause
                    ? readiness?.settled
                      ? // It has caught up since; the search itself was early.
                        `Nothing back yet — that search ran before the index had caught up. ${sentence(readinessClause)} now, so search again.`
                      : `Nothing back yet — ${readinessClause}, and the count is still climbing. Search again in a moment.`
                    : `Nothing back yet — ${processed} of ${total} images are embedded so far, and the vector index picks each one up shortly after. Search again in a moment.`
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
