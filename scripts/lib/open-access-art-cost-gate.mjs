export const OPEN_ACCESS_COST_GATE_SCHEMA_VERSION =
  'open-access-art-cost-gate-v1';

const STATUS_READY = 'ready';
const STATUS_DEFERRED = 'deferred';
const STATUS_NEEDS_DECISION = 'needs_decision';
const STATUS_NEEDS_APPROVAL = 'needs_approval';
const STATUS_MISSING_SECRET = 'missing_secret';

const DEFAULT_THRESHOLDS = {
  sampleImageEmbeddings: 10,
  sampleCaptionGenerationRows: 5,
  sampleCaptionEmbeddingRows: 5,
};

const LANE_CONFIG = {
  imageEmbeddings: {
    label: 'NGA image embeddings',
    providerValues: new Set(['pending', 'local', 'jina', 'defer']),
    paidProviders: new Set(['jina']),
    secretByProvider: {
      jina: ['JINA_API_KEY'],
    },
    countKey: 'artworkCount',
    sampleThresholdKey: 'sampleImageEmbeddings',
  },
  captionGeneration: {
    label: 'NGA missing-caption generation',
    providerValues: new Set(['pending', 'local', 'paid-api', 'defer']),
    paidProviders: new Set(['paid-api']),
    secretByProvider: {
      'paid-api': ['CAPTION_API_KEY'],
    },
    countKey: 'missingCaptionCount',
    sampleThresholdKey: 'sampleCaptionGenerationRows',
  },
  captionEmbeddings: {
    label: 'NGA generated-caption embeddings',
    providerValues: new Set(['pending', 'jina', 'defer']),
    paidProviders: new Set(['jina']),
    secretByProvider: {
      jina: ['JINA_API_KEY'],
    },
    countKey: 'missingCaptionCount',
    sampleThresholdKey: 'sampleCaptionEmbeddingRows',
  },
};

export function buildOpenAccessCostGate({
  manifest,
  generatedAt = new Date().toISOString(),
  providers = {},
  approvedBulk = false,
  env = process.env,
  thresholds = {},
} = {}) {
  if (!manifest) {
    throw new Error('manifest is required');
  }

  const normalizedThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...definedValues(thresholds),
  };
  const counts = manifestCounts(manifest);
  const lanes = {};
  const requiredSecrets = new Set();
  const requiredHumanDecisions = [];

  for (const [laneId, config] of Object.entries(LANE_CONFIG)) {
    const provider = normalizeProvider(
      providers[laneId] ?? 'pending',
      config.providerValues,
      laneId
    );
    const count = counts[config.countKey];
    const sampleThreshold = normalizedThresholds[config.sampleThresholdKey];
    const requiredSecretNames = config.secretByProvider[provider] || [];
    const missingSecrets = requiredSecretNames.filter(
      (name) => !String(env[name] || '').trim()
    );

    for (const name of requiredSecretNames) {
      requiredSecrets.add(name);
    }

    const lane = {
      id: laneId,
      label: config.label,
      provider,
      units: count,
      sampleThreshold,
      paid: config.paidProviders.has(provider),
      requiredSecretNames,
      missingSecrets,
      status: STATUS_READY,
      reason: null,
    };

    if (provider === 'pending') {
      lane.status = STATUS_NEEDS_DECISION;
      lane.reason = `${config.label} provider is not selected.`;
      requiredHumanDecisions.push({
        lane: laneId,
        decision: lane.reason,
      });
    } else if (provider === 'defer') {
      lane.status = STATUS_DEFERRED;
      lane.reason = `${config.label} is intentionally deferred.`;
    } else if (missingSecrets.length) {
      lane.status = STATUS_MISSING_SECRET;
      lane.reason = `${config.label} requires ${missingSecrets.join(', ')}.`;
    } else if (count > sampleThreshold && !approvedBulk) {
      lane.status = STATUS_NEEDS_APPROVAL;
      lane.reason = `${config.label} has ${count} units, above the sample threshold ${sampleThreshold}.`;
      requiredHumanDecisions.push({
        lane: laneId,
        decision: lane.reason,
      });
    }

    lanes[laneId] = lane;
  }

  const statuses = Object.values(lanes).map((lane) => lane.status);
  const result = statuses.some(
    (status) =>
      status === STATUS_MISSING_SECRET ||
      status === STATUS_NEEDS_DECISION ||
      status === STATUS_NEEDS_APPROVAL
  )
    ? 'blocked'
    : 'ready';
  const exitCode = gateExitCode(statuses);

  return {
    schema_version: OPEN_ACCESS_COST_GATE_SCHEMA_VERSION,
    generatedAt,
    collection: manifest.collection || null,
    counts,
    assumptions: {
      approvedBulk,
      thresholds: normalizedThresholds,
    },
    costs: {
      jina: manifest.costs?.jina || null,
      vectorize: manifest.costs?.vectorize || null,
      r2: manifest.costs?.r2 || null,
      d1: manifest.costs?.d1 || null,
      estimatedMonthlyCloudflareUsd:
        manifest.costs?.estimatedMonthlyCloudflareUsd ?? null,
      estimatedInitialCloudflareWriteUsd:
        manifest.costs?.estimatedInitialCloudflareWriteUsd ?? null,
    },
    lanes,
    requiredSecrets: Array.from(requiredSecrets).sort(),
    requiredHumanDecisions,
    result,
    exitCode,
  };
}

function manifestCounts(manifest) {
  const captionCoverage = manifest.totals?.captionCoverage || {};
  const artworkCount = Number(manifest.totals?.candidateCount || 0);
  const withInstitutionCaption = Number(
    captionCoverage.withInstitutionCaption || 0
  );
  const missingCaptionCount = Number(
    captionCoverage.missingInstitutionCaption || 0
  );
  const captionCoverageTotal = Number(captionCoverage.total || artworkCount);

  return {
    artworkCount,
    captionCoverageTotal,
    withInstitutionCaption,
    missingCaptionCount,
    jinaImageEmbeddingTokens: Number(
      manifest.costs?.jina?.imageEmbeddingTokens || 0
    ),
  };
}

function normalizeProvider(provider, allowedValues, laneId) {
  const value = String(provider || 'pending').trim().toLowerCase();
  if (!allowedValues.has(value)) {
    throw new Error(
      `${laneId} provider must be one of ${Array.from(allowedValues).join(', ')}`
    );
  }
  return value;
}

function gateExitCode(statuses) {
  if (statuses.includes(STATUS_MISSING_SECRET)) return 3;
  if (
    statuses.includes(STATUS_NEEDS_DECISION) ||
    statuses.includes(STATUS_NEEDS_APPROVAL)
  ) {
    return 4;
  }
  return 0;
}

function definedValues(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
}
