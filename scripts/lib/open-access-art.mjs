import { createHash, createHmac } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

export const R2_BUCKET_ENV = 'ANVIL_R2_BUCKET';
export const R2_CREDENTIAL_NAMES = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT',
];
export const R2_SECRET_NAMES = [R2_BUCKET_ENV, ...R2_CREDENTIAL_NAMES];
export const R2_BINDING_NAMES = ['IMAGES'];
export const R2_CONFIGURED_BUCKET_NAMES = [
  'paillette-assets-stg',
  'paillette-assets',
];
export const DEFAULT_OBJECT_PREFIX = 'generated/open-access/nga';
export const DEFAULT_QUEUE_BATCH_SIZE = 10;
export const DEFAULT_QUEUE_MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_ASSET_BYTES = 5 * 1024 * 1024;

const NGA_PROVIDER = 'nga';
const NGA_SOURCE = {
  provider: NGA_PROVIDER,
  label: 'National Gallery of Art open access published images',
  metadata_url:
    'https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/published_images.csv',
  dataset_url: 'https://github.com/NationalGalleryOfArt/opendata',
  dataset_license: 'CC0-1.0 for collection metadata',
  media_filter: 'openaccess=1 rows from published_images.csv',
};

const NGA_SAMPLE_ROWS = [
  {
    uuid: '00007f61-4922-417b-8f27-893ea328206c',
    objectId: '17387',
    width: 3365,
    height: 4332,
    assistiveText:
      'The image shows a drawing of two ceramic jugs with a shared base and distinct necks.',
  },
  {
    uuid: '0000bd8c-39de-4453-b55d-5e28a9beed38',
    objectId: '19245',
    width: 3500,
    height: 4688,
    assistiveText:
      'The image shows a large stoneware jug with dark blue floral patterns and the words Harrisburg PA.',
  },
  {
    uuid: '0001668a-dd1c-48e8-9267-b6d1697d43c8',
    objectId: '23830',
    width: 3446,
    height: 4448,
    assistiveText:
      'The image shows an ornate wrought-iron gate with a cross at the top.',
  },
  {
    uuid: '00032658-8a7a-44e3-8bb8-df8c172f521d',
    objectId: '713',
    width: 2674,
    height: 3798,
    assistiveText:
      'The image shows a group of armored figures in front of a fortress.',
  },
  {
    uuid: '00054694-8f62-47f2-ada8-45dd7a0f6391',
    objectId: '38735',
    width: 9655,
    height: 12785,
    assistiveText:
      'The image shows an artwork from the NGA public open access image sample.',
  },
  {
    uuid: '00057174-2323-4d4c-8aa2-9b4db66533b5',
    objectId: '18081',
    width: 4490,
    height: 3521,
    assistiveText:
      'The image shows an artwork from the NGA public open access image sample.',
  },
  {
    uuid: '0005bc5d-5b29-46d3-a42e-6f9ae484aa2b',
    objectId: '30832',
    width: 2713,
    height: 4183,
    assistiveText:
      'The image shows an artwork from the NGA public open access image sample.',
  },
  {
    uuid: '00066d13-9732-40ce-9fa1-6b1a39176bce',
    objectId: '11269',
    width: 3488,
    height: 4981,
    assistiveText:
      'The image shows an artwork from the NGA public open access image sample.',
  },
  {
    uuid: '0007d81b-7273-4e12-af55-5cd3ed4e3184',
    objectId: '17088',
    width: 3206,
    height: 4616,
    assistiveText:
      'The image shows an artwork from the NGA public open access image sample.',
  },
  {
    uuid: '00084ede-d1dd-45ba-86da-7dd38e46296a',
    objectId: '143647',
    width: 3200,
    height: 4603,
    assistiveText:
      'The image shows an artwork from the NGA public open access image sample.',
  },
];

export function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const trimmed = arg.slice(2);
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex !== -1) {
      values.set(trimmed.slice(0, eqIndex), trimmed.slice(eqIndex + 1));
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags.add(trimmed);
    } else {
      values.set(trimmed, next);
      index += 1;
    }
  }

  return { values, flags, positional };
}

export function numberOption(values, key, defaultValue) {
  if (!values.has(key)) return defaultValue;
  const parsed = Number(values.get(key));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${key} must be a non-negative number`);
  }
  return parsed;
}

export function listOption(values, key, defaultValue) {
  const raw = values.get(key);
  if (!raw) return defaultValue;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function assertProviders(providers) {
  const unsupported = providers.filter((provider) => provider !== NGA_PROVIDER);
  if (unsupported.length) {
    throw new Error(`unsupported provider(s): ${unsupported.join(', ')}`);
  }
}

export function buildDryRunManifest(options = {}) {
  const providers = options.providers || [NGA_PROVIDER];
  assertProviders(providers);

  const sampleSize = Math.min(
    Math.max(0, options.sampleSize ?? 5),
    NGA_SAMPLE_ROWS.length
  );
  const objectPrefix = stripSlashes(
    options.objectPrefix || DEFAULT_OBJECT_PREFIX
  );
  const imageSize = options.imageSize || '!400,400';
  const now = options.now || new Date().toISOString();
  const sampleCaption = options.sampleCaption || 'none';
  const records = NGA_SAMPLE_ROWS.slice(0, sampleSize).map((row, index) =>
    buildManifestRecord(row, { index, imageSize, objectPrefix })
  );

  return {
    schema_version: '1',
    kind: 'open_access_art_dry_run',
    generated_at: now,
    providers,
    source: NGA_SOURCE,
    sample_caption: {
      requested: sampleCaption,
      action: 'not_generated',
      reason:
        'Issue #18 proof records caption intent only; paid/bulk caption work is blocked until R2 readiness is accepted.',
    },
    r2: r2NamesReport(),
    safety: noMutationSafety(),
    summary: summarizeManifestRecords(records),
    records,
  };
}

export function buildInitialLedger(manifest, options = {}) {
  const limit = options.limit && options.limit > 0 ? options.limit : undefined;
  const records = manifest.records.slice(0, limit).map((record) => ({
    id: record.id,
    provider: record.provider,
    source_object_id: record.source_object_id,
    source_asset_id: record.source_asset_id,
    image_url: record.image_url,
    source_iiif_url: record.source_iiif_url,
    width: record.width,
    height: record.height,
    content_type: record.content_type,
    target_object_key: record.target.object_key,
    target_bucket_env: R2_BUCKET_ENV,
    download: {
      status: 'planned',
      bytes: 0,
      path: null,
      sha256: null,
      content_type: null,
      error: null,
    },
    upload: {
      status: 'not_requested',
      object_key: record.target.object_key,
      r2_bucket_env: R2_BUCKET_ENV,
      etag: null,
      error: null,
    },
  }));

  return {
    schema_version: '1',
    kind: 'open_access_art_asset_ledger',
    generated_at: new Date().toISOString(),
    manifest: {
      kind: manifest.kind,
      generated_at: manifest.generated_at,
      providers: manifest.providers,
      source: manifest.source,
    },
    r2: manifest.r2 || r2NamesReport(),
    safety: noMutationSafety(),
    records,
    summary: summarizeLedgerRecords(records),
  };
}

export function summarizeManifestRecords(records) {
  return {
    image_count: records.length,
    downloaded_bytes: 0,
    planned_target_key_count: records.length,
    target_object_keys: records.map((record) => record.target.object_key),
  };
}

export function summarizeLedgerRecords(records) {
  const downloaded = records.filter(
    (record) => record.download?.status === 'downloaded'
  );
  const downloadedBytes = downloaded.reduce(
    (sum, record) => sum + Number(record.download?.bytes || 0),
    0
  );
  const largest = downloaded.reduce(
    (max, record) => Math.max(max, Number(record.download?.bytes || 0)),
    0
  );
  const uploaded = records.filter(
    (record) => record.upload?.status === 'uploaded'
  );

  return {
    image_count: records.length,
    downloaded_count: downloaded.length,
    downloaded_bytes: downloadedBytes,
    largest_asset_bytes: largest,
    target_object_keys: records.map((record) => record.target_object_key),
    uploaded_count: uploaded.length,
    uploaded_object_keys: uploaded.map((record) => record.target_object_key),
  };
}

export function buildQueuePlan(manifest, options = {}) {
  const limit = options.limit && options.limit > 0 ? options.limit : undefined;
  const records = manifest.records.slice(0, limit);
  const batchSize = options.batchSize || DEFAULT_QUEUE_BATCH_SIZE;
  const maxAttempts = options.maxAttempts || DEFAULT_QUEUE_MAX_ATTEMPTS;
  const batches = [];

  for (let index = 0; index < records.length; index += batchSize) {
    const batchRecords = records.slice(index, index + batchSize);
    batches.push({
      batch_number: batches.length + 1,
      batch_size: batchRecords.length,
      enqueue: false,
      asset_mode: options.assetMode || 'r2',
      messages: batchRecords.map((record) => ({
        id: record.id,
        provider: record.provider,
        source_asset_id: record.source_asset_id,
        source_object_id: record.source_object_id,
        target_object_key: record.target.object_key,
        attempt: 1,
        max_attempts: maxAttempts,
      })),
    });
  }

  return {
    schema_version: '1',
    kind: 'open_access_art_queue_plan',
    generated_at: new Date().toISOString(),
    providers: manifest.providers,
    asset_mode: options.assetMode || 'r2',
    enqueue: false,
    safety: {
      ...noMutationSafety(),
      queue_messages_enqueued: false,
    },
    queue: {
      batch_size: batchSize,
      max_attempts: maxAttempts,
      retry_behavior: {
        strategy: 'bounded_exponential_backoff',
        initial_delay_ms: 1000,
        max_delay_ms: 30000,
        retryable_failures: [
          'download_error',
          'upload_error',
          'r2_5xx',
          'r2_429',
          'network_timeout',
        ],
        non_retryable_failures: [
          'missing_public_image',
          'content_type_not_image',
          'r2_readiness_blocked',
          'human_approval_required',
        ],
      },
    },
    summary: {
      planned_messages: records.length,
      planned_batches: batches.length,
      target_object_keys: records.map((record) => record.target.object_key),
    },
    batches,
  };
}

export function buildR2ReadinessReport(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date().toISOString();
  const envBucket = hasValue(env[R2_BUCKET_ENV]) ? env[R2_BUCKET_ENV] : '';
  const configuredBucket = envBucket
    ? ''
    : readConfiguredR2Bucket(options.repoRoot || process.cwd());
  const bucketName = envBucket || configuredBucket;
  const bucketPresent = hasValue(bucketName);
  const bucketNameIsDocumented =
    bucketPresent && R2_CONFIGURED_BUCKET_NAMES.includes(bucketName);
  const missingCredentials = R2_CREDENTIAL_NAMES.filter(
    (name) => !hasValue(env[name])
  );
  const missingNames = [
    ...(bucketPresent ? [] : [R2_BUCKET_ENV]),
    ...missingCredentials,
  ];
  const exitCode = !bucketPresent ? 4 : missingCredentials.length ? 3 : 0;
  const status = exitCode === 0 ? 'ready' : 'blocked';
  const blockedReason =
    exitCode === 4
      ? 'missing_human_bucket_decision'
      : exitCode === 3
        ? 'missing_secret_or_auth_names'
        : null;

  const report = {
    schema_version: '1',
    kind: 'open_access_art_r2_readiness',
    generated_at: now,
    provider: 'r2',
    status,
    exit_code: exitCode,
    blocked_reason: blockedReason,
    required_names: {
      binding_names: R2_BINDING_NAMES,
      configured_bucket_names: R2_CONFIGURED_BUCKET_NAMES,
      bucket_name_env: R2_BUCKET_ENV,
      credential_names: R2_CREDENTIAL_NAMES,
    },
    bucket_name: bucketNameIsDocumented ? bucketName : null,
    bucket_name_source: envBucket
      ? 'environment'
      : configuredBucket
        ? '.agent/storage.yaml'
        : null,
    present_names: [
      ...(bucketPresent ? [R2_BUCKET_ENV] : []),
      ...R2_CREDENTIAL_NAMES.filter((name) => hasValue(env[name])),
    ],
    missing_names: missingNames,
    prerequisite_for: [
      'open:apply --upload',
      'paid_caption_generation',
      'vector_upsert',
      'queue_enqueue',
      'd1_apply',
      'deploy',
    ],
    redaction_checks: {
      environment_values_written: false,
      report_contains_secret_values: false,
      checked_names: R2_SECRET_NAMES,
    },
  };

  const secretValues = R2_CREDENTIAL_NAMES.map((name) => env[name]).filter(
    (value) => typeof value === 'string' && value.length >= 8
  );
  const reportText = JSON.stringify(report);
  report.redaction_checks.report_contains_secret_values = secretValues.some(
    (value) => reportText.includes(value)
  );
  if (report.redaction_checks.report_contains_secret_values) {
    report.status = 'blocked';
    report.exit_code = report.exit_code || 3;
    report.blocked_reason = 'redaction_check_failed';
  }

  return report;
}

export function readConfiguredR2Bucket(repoRoot = process.cwd()) {
  const storagePath = resolve(repoRoot, '.agent/storage.yaml');
  if (!existsSync(storagePath)) return '';

  const text = readFileSync(storagePath, 'utf8');
  const lines = text.split(/\r?\n/u);
  let inObjectStorage = false;
  let objectStorageIndent = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.match(/^\s*/u)?.[0].length ?? 0;
    if (trimmed === 'object_storage:') {
      inObjectStorage = true;
      objectStorageIndent = indent;
      continue;
    }
    if (inObjectStorage && indent <= objectStorageIndent) {
      inObjectStorage = false;
    }
    if (!inObjectStorage || !trimmed.startsWith('bucket:')) continue;

    const rawValue = trimmed.slice('bucket:'.length).trim();
    const unquoted = rawValue.replace(/^['"]|['"]$/gu, '').trim();
    return unquoted || '';
  }

  return '';
}

export function r2NamesReport() {
  return {
    provider: 'r2',
    binding_names: R2_BINDING_NAMES,
    configured_bucket_names: R2_CONFIGURED_BUCKET_NAMES,
    bucket_name_env: R2_BUCKET_ENV,
    credential_names: R2_CREDENTIAL_NAMES,
    object_key_prefix: DEFAULT_OBJECT_PREFIX,
  };
}

export function noMutationSafety() {
  return {
    downloads_allowed: true,
    uploads_performed: false,
    d1_apply_performed: false,
    queue_enqueue_performed: false,
    paid_captions_performed: false,
    vectors_upserted: false,
    deploy_performed: false,
  };
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function updateLedgerSummary(ledger) {
  ledger.summary = summarizeLedgerRecords(ledger.records);
  ledger.updated_at = new Date().toISOString();
  return ledger;
}

export async function downloadLedgerAssets(ledger, options = {}) {
  const outDir = resolve(options.outDir || 'tmp/open-access-assets');
  const downloadLimit =
    options.downloadLimit && options.downloadLimit > 0
      ? options.downloadLimit
      : ledger.records.length;
  const maxBytes = options.maxBytes || DEFAULT_MAX_ASSET_BYTES;
  const selected = ledger.records.slice(0, downloadLimit);

  await mapLimit(selected, options.concurrency || 4, async (record) => {
    if (record.download?.status === 'downloaded' && record.download.path) {
      if (existsSync(record.download.path)) return;
    }

    const extension = extensionForContentType(
      record.content_type || 'image/jpeg'
    );
    const path = resolve(
      outDir,
      record.provider,
      `${record.source_asset_id}.${extension}`
    );
    const result = await downloadAsset(record.image_url, path, { maxBytes });
    record.download = {
      status: 'downloaded',
      bytes: result.bytes,
      path,
      sha256: result.sha256,
      content_type: result.contentType,
      error: null,
    };
  });

  updateLedgerSummary(ledger);
  return ledger;
}

export async function downloadAsset(url, path, options = {}) {
  const maxBytes = options.maxBytes || DEFAULT_MAX_ASSET_BYTES;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'paillette-open-access-art-proof/1.0',
      accept: 'image/*',
    },
  });

  if (!response.ok) {
    throw new Error(`download failed ${response.status} for ${url}`);
  }

  const contentType =
    response.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`download content-type is not image/*: ${contentType}`);
  }

  const contentLength = Number(response.headers.get('content-length') || '0');
  if (contentLength > maxBytes) {
    throw new Error(
      `download exceeds --max-bytes (${contentLength} > ${maxBytes})`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (bytes.length > maxBytes) {
    throw new Error(
      `download exceeds --max-bytes (${bytes.length} > ${maxBytes})`
    );
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);

  return {
    path,
    bytes: bytes.length,
    sha256: sha256Hex(bytes),
    contentType,
  };
}

export async function uploadLedgerAssetsToR2(ledger, options = {}) {
  const uploadLimit =
    options.uploadLimit && options.uploadLimit > 0 ? options.uploadLimit : 2;
  if (uploadLimit > 2 && !options.allowMoreThanTwo) {
    const error = new Error(
      'live R2 upload is capped at two records for issue #18'
    );
    error.exitCode = 4;
    throw error;
  }

  const selected = ledger.records.slice(0, uploadLimit);
  await mapLimit(selected, options.concurrency || 1, async (record) => {
    if (record.download?.status !== 'downloaded' || !record.download.path) {
      throw new Error(`record ${record.id} must be downloaded before upload`);
    }

    const body = readFileSync(record.download.path);
    const result = await putR2Object({
      body,
      key: record.target_object_key,
      contentType:
        record.download.content_type || record.content_type || 'image/jpeg',
      env: options.env || process.env,
    });
    record.upload = {
      status: 'uploaded',
      object_key: record.target_object_key,
      r2_bucket_env: R2_BUCKET_ENV,
      etag: result.etag,
      bytes: body.length,
      sha256: sha256Hex(body),
      content_type:
        record.download.content_type || record.content_type || 'image/jpeg',
      error: null,
    };
  });

  updateLedgerSummary(ledger);
  return ledger;
}

export async function putR2Object({
  body,
  key,
  contentType,
  env = process.env,
}) {
  const bucket = env[R2_BUCKET_ENV];
  const endpoint = trimTrailingSlash(env.R2_ENDPOINT || '');
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 upload requested before required R2 names are present');
  }

  const url = new URL(
    `${endpoint}/${encodePathSegment(bucket)}/${key.split('/').map(encodePathSegment).join('/')}`
  );
  const payloadHash = sha256Hex(body);
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const host = url.host;
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join('\n');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    url.pathname,
    '',
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = awsSigningKey(secretAccessKey, dateStamp, 'auto', 's3');
  const signature = createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization,
      'content-type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`R2 upload failed with status ${response.status}`);
  }

  return {
    status: response.status,
    etag: response.headers.get('etag'),
  };
}

export function writeAssetManifest(path, ledger, options = {}) {
  const records = ledger.records
    .filter((record) => record.download?.status === 'downloaded')
    .map((record) => ({
      provider: record.provider,
      source_object_id: record.source_object_id,
      source_asset_id: record.source_asset_id,
      object_key: record.target_object_key,
      content_type: record.download.content_type || record.content_type,
      byte_size: record.download.bytes,
      sha256: record.download.sha256,
      uploaded: record.upload?.status === 'uploaded',
      upload_etag: record.upload?.etag || null,
      r2_bucket_env: R2_BUCKET_ENV,
    }));

  const manifest = {
    schema_version: '1',
    kind: 'open_access_art_asset_manifest',
    generated_at: new Date().toISOString(),
    asset_mode: options.assetMode || 'r2',
    upload_requested: Boolean(options.uploadRequested),
    upload_performed: records.some((record) => record.uploaded),
    readiness_report: options.readinessReport || null,
    r2: r2NamesReport(),
    safety: {
      ...noMutationSafety(),
      uploads_performed: records.some((record) => record.uploaded),
    },
    summary: summarizeLedgerRecords(ledger.records),
    records,
  };
  writeJson(path, manifest);
  return manifest;
}

export function assertNoForbiddenApplyFlags(flags) {
  const forbidden = ['apply-d1', 'apply', 'upsert-vectors', 'enqueue'];
  const found = forbidden.filter((flag) => flags.has(flag));
  if (found.length) {
    const error = new Error(
      `issue #18 proof forbids mutation flags: ${found.map((flag) => `--${flag}`).join(', ')}`
    );
    error.exitCode = 4;
    throw error;
  }
}

export function fileSize(path) {
  return statSync(path).size;
}

function buildManifestRecord(row, options) {
  const iiifUrl = `https://api.nga.gov/iiif/${row.uuid}`;
  const imageUrl = `${iiifUrl}/full/${options.imageSize}/0/default.jpg`;
  const objectKey = `${options.objectPrefix}/${row.objectId}/${row.uuid}.jpg`;
  return {
    id: `nga:${row.objectId}:${row.uuid}`,
    provider: NGA_PROVIDER,
    source_object_id: row.objectId,
    source_asset_id: row.uuid,
    source_iiif_url: iiifUrl,
    image_url: imageUrl,
    thumbnail_url: `${iiifUrl}/full/!200,200/0/default.jpg`,
    width: row.width,
    height: row.height,
    openaccess: true,
    content_type: 'image/jpeg',
    assistive_text: row.assistiveText,
    target: {
      provider: 'r2',
      bucket_env: R2_BUCKET_ENV,
      object_key: objectKey,
      content_type: 'image/jpeg',
    },
  };
}

function stripSlashes(value) {
  return String(value).replace(/^\/+|\/+$/gu, '');
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/u, '');
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/%2F/giu, '/');
}

function extensionForContentType(contentType) {
  const normalized = String(contentType).toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('tiff')) return 'tif';
  return 'jpg';
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function mapLimit(items, limit, worker) {
  const concurrency = Math.max(1, Math.floor(limit || 1));
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index], index);
      }
    }
  );
  await Promise.all(workers);
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/gu, '');
}

function awsSigningKey(secret, dateStamp, region, service) {
  const dateKey = createHmac('sha256', `AWS4${secret}`)
    .update(dateStamp)
    .digest();
  const dateRegionKey = createHmac('sha256', dateKey).update(region).digest();
  const dateRegionServiceKey = createHmac('sha256', dateRegionKey)
    .update(service)
    .digest();
  return createHmac('sha256', dateRegionServiceKey)
    .update('aws4_request')
    .digest();
}
