import type { Context, MiddlewareHandler, Next } from 'hono';
import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import type { Env } from '../index';
import { generateId, generateToken, hashApiKey } from '../utils/crypto';
import { resolveOpenAccessProviderScope } from '../utils/orgs';
import { verifyIdentityToken } from '../auth/identity-token';
import {
  D1SearchAccessRepository,
  parseSearchAccessMode,
  resolveSearchAccess,
  type GrantedSearchAccessDecision,
  type SearchAccessDecision,
} from '../auth/search-access';

export type PrincipalKind = 'user' | 'api_key';

export interface AuthPrincipal {
  kind: PrincipalKind;
  userId: string;
  email?: string;
  name?: string;
  apiKeyId?: string;
  scopes: string[];
  externalIssuer?: string;
  externalSubject?: string;
  searchAccess?: GrantedSearchAccessDecision;
  /** A short-lived, signed handoff created by the MCP route for an internal
   * REST call. Never accepted from a bearer token. */
  internalMcp?: true;
}

type Variables = {
  auth: AuthPrincipal;
  usageEventId: string;
  usageEventMetadata?: Record<string, unknown>;
};

type AppBindings = {
  Bindings: Env;
  Variables: Variables;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const getBearerToken = (authorization: string | undefined) => {
  const prefix = 'Bearer ';
  if (!authorization?.startsWith(prefix)) {
    return null;
  }

  return authorization.slice(prefix.length).trim();
};

export const MCP_INTERNAL_CAPABILITY_HEADER =
  'X-Paillette-MCP-Internal-Capability';

const MCP_INTERNAL_CAPABILITY_TTL_MS = 15_000;

export class McpInternalCapabilityConfigurationError extends Error {
  constructor() {
    super('MCP internal capability is unavailable');
    this.name = 'McpInternalCapabilityConfigurationError';
  }
}

type McpInternalCapabilityPayload = {
  v: 1;
  exp: number;
  method: string;
  path: string;
  userId: string;
  email?: string;
  name?: string;
  scopes: string[];
};

const encodeBase64Url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const decodeBase64Url = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

const getMcpCapabilityKey = async (env: Env) => {
  const secret = env.MCP_INTERNAL_CAPABILITY_SECRET?.trim();
  if (!secret) throw new McpInternalCapabilityConfigurationError();
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
};

/**
 * Creates a narrow internal-only credential for an MCP tool's single REST
 * call. It binds the authenticated MCP identity to one HTTP method and path;
 * it deliberately does not carry or forward the caller's OAuth bearer token.
 */
export const createMcpInternalCapability = async (
  env: Env,
  auth: AuthPrincipal,
  method: string,
  path: string,
  expiresAt = Date.now() + MCP_INTERNAL_CAPABILITY_TTL_MS
) => {
  const payload: McpInternalCapabilityPayload = {
    v: 1,
    exp: expiresAt,
    method: method.toUpperCase(),
    path,
    userId: auth.userId,
    ...(auth.email ? { email: auth.email } : {}),
    ...(auth.name ? { name: auth.name } : {}),
    scopes: auth.scopes,
  };
  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await getMcpCapabilityKey(env),
    new TextEncoder().encode(encodedPayload)
  );
  return `v1.${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
};

const verifyMcpInternalCapability = async (
  c: Context<AppBindings>
): Promise<AuthPrincipal | null> => {
  const capability = c.req.header(MCP_INTERNAL_CAPABILITY_HEADER);
  if (!capability) return null;

  const [version, encodedPayload, encodedSignature, ...extra] = capability.split('.');
  if (version !== 'v1' || !encodedPayload || !encodedSignature || extra.length) {
    return null;
  }
  const payloadBytes = decodeBase64Url(encodedPayload);
  const signature = decodeBase64Url(encodedSignature);
  if (!payloadBytes || !signature) return null;

  const valid = await crypto.subtle.verify(
    'HMAC',
    await getMcpCapabilityKey(c.env),
    signature,
    new TextEncoder().encode(encodedPayload)
  );
  if (!valid) return null;

  let payload: McpInternalCapabilityPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (
    payload.v !== 1 ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= Date.now() ||
    payload.method !== c.req.method.toUpperCase() ||
    payload.path !== new URL(c.req.url).pathname ||
    typeof payload.userId !== 'string' ||
    !payload.userId ||
    !Array.isArray(payload.scopes) ||
    !payload.scopes.every((scope) => typeof scope === 'string')
  ) {
    return null;
  }

  return {
    kind: 'user',
    userId: payload.userId,
    email: payload.email,
    name: payload.name,
    scopes: payload.scopes,
    internalMcp: true,
  } satisfies AuthPrincipal;
};

const getJwks = (issuer: string, explicitJwksUri?: string) => {
  const jwksUri = explicitJwksUri || `${trimTrailingSlash(issuer)}/jwks`;
  const cached = jwksCache.get(jwksUri);

  if (cached) {
    return cached;
  }

  const jwks = createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(jwksUri, jwks);
  return jwks;
};

const getScopes = (payload: JWTPayload) => {
  const scope = payload.scope;
  return typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [];
};

class AccessDecisionError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code:
      | 'AUTHENTICATION_REQUIRED'
      | 'ACCESS_PENDING'
      | 'IDENTITY_BINDING_REQUIRED',
    message: string
  ) {
    super(message);
  }
}

const getAccessErrorMessage = (code: AccessDecisionError['code']) => {
  if (code === 'ACCESS_PENDING') return 'This account is awaiting approval';
  if (code === 'IDENTITY_BINDING_REQUIRED') {
    return 'This account requires identity review';
  }
  return 'Authentication is required';
};

const accessErrorResponse = (
  c: Context<AppBindings>,
  error: AccessDecisionError
) =>
  c.json(
    {
      success: false,
      error: { code: error.code, message: getAccessErrorMessage(error.code) },
    },
    error.status
  );

function requireGrantedDecision(
  decision: SearchAccessDecision
): asserts decision is GrantedSearchAccessDecision {
  if (!decision.granted) {
    throw new AccessDecisionError(
      decision.status,
      decision.code,
      getAccessErrorMessage(decision.code)
    );
  }
}

const getUserInfoEndpoint = (issuer: string) =>
  `${trimTrailingSlash(issuer)}/me`;

const allowsIssuerOnlyLogtoFallback = (env: Env) => {
  const environment = env.ENVIRONMENT?.toLowerCase();
  return (
    environment === 'local' ||
    environment === 'development' ||
    environment === 'dev' ||
    environment === 'test'
  );
};

const fetchLogtoUserInfo = async (
  issuer: string,
  token: string
): Promise<JWTPayload> => {
  const response = await fetch(getUserInfoEndpoint(issuer), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Logto userinfo rejected token with ${response.status}`);
  }

  const payload = (await response.json()) as JWTPayload;

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('Missing subject in Logto userinfo response');
  }

  return payload;
};

const getApiKeyHashInput = (apiKey: string, env: Env) =>
  env.API_KEY_PEPPER ? `${env.API_KEY_PEPPER}.${apiKey}` : apiKey;

const truncate = (value: string | undefined | null, maxLength = 512) =>
  value ? value.slice(0, maxLength) : null;

const toStringOrNull = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : null;

const toNumberOrNull = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const getBrowser = (userAgent: string | null) => {
  if (!userAgent) {
    return { name: null, version: null };
  }

  const browserPatterns: Array<[string, RegExp]> = [
    ['Edge', /Edg\/([\d.]+)/],
    ['Chrome', /Chrome\/([\d.]+)/],
    ['Firefox', /Firefox\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
    ['Opera', /OPR\/([\d.]+)/],
  ];

  for (const [name, pattern] of browserPatterns) {
    const match = userAgent.match(pattern);
    if (match?.[1]) {
      return { name, version: match[1] };
    }
  }

  if (/curl/i.test(userAgent)) {
    return {
      name: 'curl',
      version: userAgent.match(/curl\/([\d.]+)/)?.[1] ?? null,
    };
  }

  if (/python-requests/i.test(userAgent)) {
    return {
      name: 'python-requests',
      version: userAgent.match(/python-requests\/([\d.]+)/)?.[1] ?? null,
    };
  }

  if (/node/i.test(userAgent)) {
    return { name: 'node', version: null };
  }

  return { name: 'Unknown', version: null };
};

const getOs = (userAgent: string | null) => {
  if (!userAgent) {
    return { name: null, version: null };
  }

  const osPatterns: Array<[string, RegExp]> = [
    ['iOS', /OS ([\d_]+) like Mac OS X/],
    ['macOS', /Mac OS X ([\d_]+)/],
    ['Windows', /Windows NT ([\d.]+)/],
    ['Android', /Android ([\d.]+)/],
    ['Linux', /Linux/],
  ];

  for (const [name, pattern] of osPatterns) {
    const match = userAgent.match(pattern);
    if (match) {
      return {
        name,
        version: match[1]?.replaceAll('_', '.') ?? null,
      };
    }
  }

  return { name: 'Unknown', version: null };
};

const getDeviceType = (
  userAgent: string | null,
  secChUaMobile: string | null
) => {
  if (secChUaMobile === '?1') {
    return 'mobile';
  }

  if (!userAgent) {
    return null;
  }

  if (/ipad|tablet/i.test(userAgent)) {
    return 'tablet';
  }

  if (/mobile|iphone|android/i.test(userAgent)) {
    return 'mobile';
  }

  if (/curl|python-requests|node|postman|insomnia/i.test(userAgent)) {
    return 'api_client';
  }

  return 'desktop';
};

const getRequestMetadata = (c: Context<AppBindings>) => {
  const rawRequest = c.req.raw as Request & { cf?: Record<string, unknown> };
  const cf = rawRequest.cf ?? {};
  const userAgent = truncate(c.req.header('User-Agent'), 1024);
  const secChUaMobile = truncate(c.req.header('Sec-CH-UA-Mobile'), 32);
  const browser = getBrowser(userAgent);
  const os = getOs(userAgent);

  const metadata = {
    accept: truncate(c.req.header('Accept'), 1024),
    acceptEncoding: truncate(c.req.header('Accept-Encoding'), 256),
    cacheControl: truncate(c.req.header('Cache-Control'), 256),
    cf: {
      clientTcpRtt: toNumberOrNull(cf.clientTcpRtt),
      edgeRequestKeepAliveStatus: toNumberOrNull(cf.edgeRequestKeepAliveStatus),
      isEUCountry: cf.isEUCountry === '1' || cf.isEUCountry === true,
      tlsClientAuth: cf.tlsClientAuth ?? null,
      verifiedBotCategory: toStringOrNull(cf.verifiedBotCategory),
    },
  };

  return {
    ipAddress: truncate(
      c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For'),
      128
    ),
    userAgent,
    browserName: browser.name,
    browserVersion: browser.version,
    osName: os.name,
    osVersion: os.version,
    deviceType: getDeviceType(userAgent, secChUaMobile),
    country:
      toStringOrNull(cf.country) || truncate(c.req.header('CF-IPCountry'), 16),
    region: toStringOrNull(cf.region),
    regionCode: toStringOrNull(cf.regionCode),
    city: toStringOrNull(cf.city),
    postalCode: toStringOrNull(cf.postalCode),
    timezone: toStringOrNull(cf.timezone),
    continent: toStringOrNull(cf.continent),
    latitude: toNumberOrNull(cf.latitude),
    longitude: toNumberOrNull(cf.longitude),
    colo: toStringOrNull(cf.colo),
    asn: toNumberOrNull(cf.asn),
    asOrganization: toStringOrNull(cf.asOrganization),
    cfRay: truncate(c.req.header('CF-Ray'), 128),
    requestProtocol: truncate(c.req.header('X-Forwarded-Proto'), 32),
    httpProtocol: toStringOrNull(cf.httpProtocol),
    tlsVersion: toStringOrNull(cf.tlsVersion),
    tlsCipher: toStringOrNull(cf.tlsCipher),
    referer: truncate(c.req.header('Referer'), 1024),
    origin: truncate(c.req.header('Origin'), 512),
    acceptLanguage: truncate(c.req.header('Accept-Language'), 512),
    contentType: truncate(c.req.header('Content-Type'), 256),
    secChUa: truncate(c.req.header('Sec-CH-UA'), 512),
    secChUaPlatform: truncate(c.req.header('Sec-CH-UA-Platform'), 128),
    secChUaMobile,
    metadata: JSON.stringify(metadata),
  };
};

const parseUsageMetadata = (metadata: string | null | undefined) => {
  if (!metadata) {
    return {};
  }

  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

export const recordApiUsageEvent = async (
  c: Context<AppBindings>,
  options: {
    queryType?: string | null;
    orgId?: string | null;
    collectionId?: string | null;
    metadata?: Record<string, unknown>;
  }
) => {
  const auth = getAuth(c);
  const usageDate = new Date().toISOString().slice(0, 10);
  const usageEventId = generateId();
  const requestMetadata = getRequestMetadata(c);
  const mergedMetadata = {
    ...parseUsageMetadata(requestMetadata.metadata),
    ...(options.metadata ?? {}),
  };

  await c.env.DB.prepare(
    `
    INSERT INTO api_usage_events (
      id, user_id, api_key_id, usage_date, method, path, route, query_type,
      org_id, collection_id, auth_kind, ip_address, user_agent,
      browser_name, browser_version, os_name, os_version, device_type,
      country, region, region_code, city, postal_code, timezone, continent,
      latitude, longitude, colo, asn, as_organization, cf_ray,
      request_protocol, http_protocol, tls_version, tls_cipher,
      referer, origin, accept_language, content_type,
      sec_ch_ua, sec_ch_ua_platform, sec_ch_ua_mobile, metadata
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      usageEventId,
      auth.userId,
      auth.apiKeyId || null,
      usageDate,
      c.req.method,
      new URL(c.req.url).pathname,
      c.req.routePath,
      options.queryType ?? null,
      options.orgId ?? c.req.param('orgId') ?? c.req.param('galleryId') ?? null,
      options.collectionId ?? c.req.param('collectionId') ?? null,
      auth.kind,
      requestMetadata.ipAddress,
      requestMetadata.userAgent,
      requestMetadata.browserName,
      requestMetadata.browserVersion,
      requestMetadata.osName,
      requestMetadata.osVersion,
      requestMetadata.deviceType,
      requestMetadata.country,
      requestMetadata.region,
      requestMetadata.regionCode,
      requestMetadata.city,
      requestMetadata.postalCode,
      requestMetadata.timezone,
      requestMetadata.continent,
      requestMetadata.latitude,
      requestMetadata.longitude,
      requestMetadata.colo,
      requestMetadata.asn,
      requestMetadata.asOrganization,
      requestMetadata.cfRay,
      requestMetadata.requestProtocol,
      requestMetadata.httpProtocol,
      requestMetadata.tlsVersion,
      requestMetadata.tlsCipher,
      requestMetadata.referer,
      requestMetadata.origin,
      requestMetadata.acceptLanguage,
      requestMetadata.contentType,
      requestMetadata.secChUa,
      requestMetadata.secChUaPlatform,
      requestMetadata.secChUaMobile,
      JSON.stringify(mergedMetadata)
    )
    .run();

  c.set('usageEventId', usageEventId);
  c.set('usageEventMetadata', mergedMetadata);

  return usageEventId;
};

export const annotateUsageEvent = async (
  c: Context<AppBindings>,
  metadata: Record<string, unknown>
) => {
  const usageEventId = c.get('usageEventId');
  if (!usageEventId) {
    return;
  }

  const mergedMetadata = {
    ...(c.get('usageEventMetadata') ?? {}),
    ...metadata,
  };

  c.set('usageEventMetadata', mergedMetadata);

  await c.env.DB.prepare(
    'UPDATE api_usage_events SET metadata = ? WHERE id = ?'
  )
    .bind(JSON.stringify(mergedMetadata), usageEventId)
    .run();
};

export const createApiKey = async (env: Env) => {
  const prefix = env.ENVIRONMENT === 'production' ? 'plt_live' : 'plt_stg';
  const rawSecret = generateToken(24);
  const key = `${prefix}_${rawSecret}`;
  const keyHash = await hashApiKey(getApiKeyHashInput(key, env));

  return {
    key,
    keyHash,
    keyPrefix: key.slice(0, 18),
  };
};

const ensureUser = async (c: Context<AppBindings>, auth: AuthPrincipal) => {
  const email = auth.email || `${auth.userId}@logto.local`;
  const name = auth.name || email.split('@')[0] || auth.userId;

  await c.env.DB.prepare(
    `
    INSERT INTO users (id, email, password_hash, name, role, last_login_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      last_login_at = datetime('now')
    `
  )
    .bind(auth.userId, email, 'logto-managed', name, 'viewer')
    .run();
};

const verifyLogtoToken = async (c: Context<AppBindings>, token: string) => {
  const issuer = c.env.LOGTO_ISSUER || 'https://m2fmae.logto.app/oidc';
  const jwks = getJwks(issuer, c.env.LOGTO_JWKS_URI);
  const audience = c.env.LOGTO_API_RESOURCE || undefined;

  let payload: JWTPayload;

  if (audience) {
    const verified = await jwtVerify(token, jwks, {
      issuer,
      audience,
    });
    payload = verified.payload;
  } else {
    if (!allowsIssuerOnlyLogtoFallback(c.env)) {
      throw new Error(
        'LOGTO_API_RESOURCE is required outside local development'
      );
    }

    try {
      const verified = await jwtVerify(token, jwks, { issuer });
      payload = verified.payload;
    } catch {
      payload = await fetchLogtoUserInfo(issuer, token);
    }
  }

  const auth: AuthPrincipal = {
    kind: 'user',
    userId: payload.sub || '',
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name:
      typeof payload.name === 'string'
        ? payload.name
        : typeof payload.username === 'string'
          ? payload.username
          : undefined,
    scopes: getScopes(payload),
  };

  if (!auth.userId) {
    throw new Error('Missing subject in Logto token');
  }

  await ensureUser(c, auth);
  return auth;
};

/**
 * MCP's advertised OAuth authorization server is distinct from WorkOS
 * AuthKit. Accept those access tokens only on the MCP resource and only with
 * the exact configured issuer, JWKS URI, and resource audience.
 */
const verifyMcpOAuthToken = async (
  c: Context<AppBindings>,
  token: string
): Promise<AuthPrincipal> => {
  const issuer = c.env.LOGTO_ISSUER;
  const jwksUri = c.env.LOGTO_JWKS_URI;
  const audience = c.env.LOGTO_API_RESOURCE;
  if (
    !issuer ||
    !jwksUri ||
    !audience ||
    issuer !== issuer.trim() ||
    jwksUri !== jwksUri.trim() ||
    audience !== audience.trim()
  ) {
    throw new Error('MCP OAuth is not configured');
  }

  const { payload } = await jwtVerify(token, getJwks(issuer, jwksUri), {
    issuer,
    audience,
  });
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Missing subject in MCP OAuth token');
  }

  return {
    kind: 'user',
    userId: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    scopes: getScopes(payload),
  };
};

const isMcpRequest = (c: Context<AppBindings>) =>
  /(?:^|\/)api\/v1\/mcp(?:\/|$)|(?:^|\/)mcp(?:\/|$)/.test(c.req.path);

const verifyBearerForRoute = async (c: Context<AppBindings>, token: string) => {
  // Decode solely to select the dedicated verifier. Each verifier still
  // verifies signature, issuer, expiry, and its own audience independently.
  const tokenIssuer = decodeJwt(token).iss;
  if (isMcpRequest(c) && tokenIssuer === c.env.LOGTO_ISSUER) {
    return verifyMcpOAuthToken(c, token);
  }
  return verifyConfiguredIdentityToken(c, token);
};

/**
 * Verifies a WorkOS AuthKit session token and binds it to the single internal
 * user identified by its immutable issuer + subject pair. Email is profile
 * data only; it is never used as an identity key.
 */
const verifyConfiguredIdentityToken = async (
  c: Context<AppBindings>,
  token: string
): Promise<AuthPrincipal> => {
  const clientId = c.env.AUTH_CLIENT_ID;
  const issuer = c.env.AUTH_ISSUER;
  const jwksUri = c.env.AUTH_JWKS_URI;

  // Keep the existing local Logto test/dev path only while WorkOS has not
  // been configured. Deployed environments must always configure WorkOS.
  if (
    !clientId ||
    !issuer ||
    !jwksUri ||
    clientId !== clientId.trim() ||
    issuer !== issuer.trim() ||
    jwksUri !== jwksUri.trim()
  ) {
    if (allowsIssuerOnlyLogtoFallback(c.env)) {
      return verifyLogtoToken(c, token);
    }
    throw new Error('Authentication is not configured');
  }

  const identity = await verifyIdentityToken(
    token,
    { issuer, clientId },
    getJwks(issuer, jwksUri)
  );
  if (!identity.emailVerified) {
    throw new Error('WorkOS email is not verified');
  }

  const decision = await resolveSearchAccess(
    new D1SearchAccessRepository(c.env.DB),
    identity,
    parseSearchAccessMode(c.env.SEARCH_ACCESS_MODE),
    c.env.SEARCH_ACCESS_BOOTSTRAP_EMAIL || ''
  );
  requireGrantedDecision(decision);

  if (!decision.internalUserId) {
    throw new Error('Authenticated identity did not resolve to a user');
  }

  return {
    kind: 'user',
    userId: decision.internalUserId,
    email: identity.email,
    name: identity.name,
    // AuthKit session tokens do not carry OAuth scopes. A verified user is
    // granted the baseline MCP read scope; write scopes remain absent.
    scopes: ['mcp:read'],
    externalIssuer: identity.issuer,
    externalSubject: identity.subject,
    searchAccess: decision,
  } satisfies AuthPrincipal;
};

const verifyPersonalApiKey = async (
  c: Context<AppBindings>,
  apiKey: string
): Promise<AuthPrincipal | null> => {
  const keyHash = await hashApiKey(getApiKeyHashInput(apiKey, c.env));
  const row = await c.env.DB.prepare(
    `
    SELECT
      ak.id,
      ak.user_id,
      u.email,
      u.name
    FROM api_keys ak
    JOIN users u ON u.id = ak.user_id
    WHERE ak.key_hash = ?
      AND ak.status = 'active'
    `
  )
    .bind(keyHash)
    .first<{
      id: string;
      user_id: string;
      email: string;
      name: string;
    }>();

  if (!row) {
    return null;
  }

  await c.env.DB.prepare(
    "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?"
  )
    .bind(row.id)
    .run();

  return {
    kind: 'api_key',
    userId: row.user_id,
    email: row.email,
    name: row.name,
    apiKeyId: row.id,
    scopes: [],
  } satisfies AuthPrincipal;
};

const getApiKeyFromRequest = (
  c: Context<AppBindings>,
  bearerToken: string | null
) => {
  const explicitKey = c.req.header('X-API-Key');
  if (explicitKey) {
    return explicitKey.trim();
  }

  if (bearerToken?.startsWith('plt_')) {
    return bearerToken;
  }

  return null;
};

const verifyPublicSearchApiKey = (
  c: Context<AppBindings>,
  apiKey: string
): AuthPrincipal | null => {
  const configuredKey = c.env.PAILLETTE_PUBLIC_SEARCH_API_KEY?.trim();
  if (!configuredKey || apiKey !== configuredKey) {
    return null;
  }

  return {
    kind: 'user',
    userId: 'public-search-web',
    email: 'public-search-web@paillette.local',
    name: 'Public Search Web',
    scopes: ['public_search'],
  } satisfies AuthPrincipal;
};

// Route unit tests mount handlers without the application-wide WorkOS
// boundary. Keep their synthetic principal behind the literal test runtime
// marker; staging, production, and local workers never trust user headers.
const getTestPrincipal = (c: Context<AppBindings>): AuthPrincipal | null => {
  if (c.env.ENVIRONMENT !== 'test') return null;
  const userId = c.req.header('X-User-Id');
  if (!userId) return null;
  const isPublicSearchProxy = userId === 'public-search-web';
  const explicitScopes = c.req
    .header('X-User-Scopes')
    ?.split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return {
    kind: 'user',
    userId,
    email: c.req.header('X-User-Email') || `${userId}@test.local`,
    name: c.req.header('X-User-Name') || userId,
    scopes: isPublicSearchProxy
      ? ['test', 'public_search']
      : explicitScopes?.length
        ? ['test', ...explicitScopes]
        : userId === 'mcp-user'
          ? ['test', 'mcp:read']
          : ['test'],
  } satisfies AuthPrincipal;
};

export const requireUser = async (c: Context<AppBindings>, next: Next) => {
  // API-wide authentication may already have verified a bearer token or a
  // narrow internal MCP capability. Re-verifying would discard that principal
  // before route-local authorization can make its deliberate 403 decision.
  const existingAuth = c.get('auth');
  if (existingAuth) {
    if (existingAuth.kind === 'user') {
      await next();
      return;
    }
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Sign-in required',
        },
      },
      401
    );
  }

  try {
    const bearerToken = getBearerToken(c.req.header('Authorization'));
    const auth = bearerToken
      ? await verifyBearerForRoute(c, bearerToken)
      : getTestPrincipal(c);

    if (!auth || auth.kind !== 'user') {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Sign-in required',
          },
        },
        401
      );
    }

    if (!auth.externalSubject) {
      await ensureUser(c, auth);
    }
    c.set('auth', auth);
    await next();
  } catch (error) {
    if (error instanceof AccessDecisionError) {
      return accessErrorResponse(c, error);
    }
    console.error('Auth error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired authentication token',
        },
      },
      401
    );
  }
};

export const requireApprovedDataAccess = async (
  c: Context<AppBindings>,
  next: Next
) => {
  const mode = parseSearchAccessMode(c.env.SEARCH_ACCESS_MODE);
  if (mode === 'public') {
    await next();
    return;
  }

  const auth = c.get('auth');
  if (!auth) {
    return accessErrorResponse(
      c,
      new AccessDecisionError(
        401,
        'AUTHENTICATION_REQUIRED',
        'Authentication is required'
      )
    );
  }

  // Synthetic principals are only constructed for the literal unit-test
  // runtime above; never consult this branch for deployed traffic.
  if (c.env.ENVIRONMENT === 'test' && auth.scopes.includes('test')) {
    await next();
    return;
  }

  // Personal keys have already proved possession of a key owned by a known
  // internal user. They remain usable in authenticated mode without a second
  // WorkOS/allowlist check.
  if (auth.kind === 'api_key' || auth.scopes.includes('public_search')) {
    await next();
    return;
  }

  if (mode === 'authenticated' || auth.searchAccess?.granted) {
    await next();
    return;
  }

  const approved = await new D1SearchAccessRepository(
    c.env.DB
  ).hasActiveApproval(auth.userId);
  if (!approved) {
    return accessErrorResponse(
      c,
      new AccessDecisionError(
        403,
        'ACCESS_PENDING',
        'This account is awaiting approval'
      )
    );
  }

  await next();
};

const isPublicSearchApiRoute = (c: Context<AppBindings>) =>
  /^(?:\/api\/v1)?\/(?:orgs|galleries)\/nga\/search\/(?:text|image|color|quota)$/.test(
    c.req.path
  );

export const requireAuthOrApiKey = async (
  c: Context<AppBindings>,
  next: Next
) => {
  try {
    // Nested routes still apply this middleware when mounted independently.
    // The API-wide boundary may already have set a principal, in which case
    // do not reverify/rewrite usage or reserve quota twice.
    if (c.get('auth')) {
      await next();
      return;
    }
    const internalMcpAuth = await verifyMcpInternalCapability(c);
    const bearerToken = getBearerToken(c.req.header('Authorization'));
    const apiKey = getApiKeyFromRequest(c, bearerToken);

    const auth =
      internalMcpAuth ||
      (apiKey ? verifyPublicSearchApiKey(c, apiKey) : null) ||
      (apiKey ? await verifyPersonalApiKey(c, apiKey) : null) ||
      (bearerToken && !bearerToken.startsWith('plt_')
        ? await verifyBearerForRoute(c, bearerToken)
        : null) ||
      getTestPrincipal(c);

    if (!auth) {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'A valid bearer token or API key is required',
          },
        },
        401
      );
    }

    if (auth.scopes.includes('public_search') && !isPublicSearchApiRoute(c)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'This API key is restricted to NGA public search',
          },
        },
        403
      );
    }

    if (
      auth.kind === 'user' &&
      !auth.externalSubject &&
      !auth.scopes.includes('public_search')
    ) {
      await ensureUser(c, auth);
    }

    c.set('auth', auth);
    return requireApprovedDataAccess(c, next);
  } catch (error) {
    if (error instanceof AccessDecisionError) {
      return accessErrorResponse(c, error);
    }
    if (error instanceof McpInternalCapabilityConfigurationError) {
      return c.json(
        {
          success: false,
          error: {
            code: 'MCP_INTERNAL_CAPABILITY_UNAVAILABLE',
            message: 'MCP internal capability is unavailable',
          },
        },
        503
      );
    }
    console.error('Auth error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'A valid bearer token or API key is required',
        },
      },
      401
    );
  }
};

export const getAuth = (c: Context<AppBindings>) => c.get('auth');

/**
 * Database-backed write authorization. Authentication and search access are
 * deliberately insufficient: a freshly provisioned WorkOS identity is a
 * viewer until an administrator grants an organisation role.
 */
export const canMutateOrg = async (
  db: D1Database,
  auth: AuthPrincipal,
  orgId: string | null | undefined
) => {
  if (!orgId || auth.scopes.includes('public_search')) {
    return false;
  }

  try {
    const allowed = await db
      .prepare(
        `
          SELECT 1 AS allowed
          FROM users
          WHERE id = ? AND role = 'admin'
          UNION ALL
          SELECT 1 AS allowed
          FROM orgs
          WHERE id = ?
            AND owner_id = ?
            AND lower(COALESCE(slug, '')) NOT IN (
              'open-access-art',
              'national-gallery-singapore'
            )
          UNION ALL
          SELECT 1 AS allowed
          FROM org_users
          JOIN orgs ON orgs.id = org_users.org_id
          WHERE org_users.org_id = ?
            AND org_users.user_id = ?
            AND org_users.role IN ('admin', 'curator')
            AND lower(COALESCE(orgs.slug, '')) NOT IN (
              'open-access-art',
              'national-gallery-singapore'
            )
          LIMIT 1
        `
      )
      .bind(auth.userId, orgId, auth.userId, orgId, auth.userId)
      .first<{ allowed: 1 }>();
    return Boolean(allowed?.allowed);
  } catch (error) {
    console.error('Organisation write authorization failed:', error);
    return false;
  }
};

export const canMutateGlobally = async (
  db: D1Database,
  auth: AuthPrincipal
) => {
  if (auth.scopes.includes('public_search')) return false;
  try {
    const row = await db
      .prepare(`SELECT 1 AS allowed FROM users WHERE id = ? AND role = 'admin'`)
      .bind(auth.userId)
      .first<{ allowed: 1 }>();
    return Boolean(row?.allowed);
  } catch (error) {
    console.error('Global write authorization failed:', error);
    return false;
  }
};

export const requireOrgMutationAccess = async (
  c: Context<AppBindings>,
  orgId: string | null | undefined
) => {
  const auth = getAuth(c);
  if (auth && (await canMutateOrg(c.env.DB, auth, orgId))) return null;
  return c.json(
    {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Organisation write access is required' },
    },
    403
  );
};

export const requireGlobalMutationAccess = async (c: Context<AppBindings>) => {
  const auth = getAuth(c);
  if (auth && (await canMutateGlobally(c.env.DB, auth))) return null;
  return c.json(
    {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Administrator access is required' },
    },
    403
  );
};

export type ArtworkUsageInteraction =
  | 'result'
  | 'view'
  | 'click'
  | 'download'
  | 'citation_copy';

export const enforceDailyQuota = (options: {
  queryType: string;
  cost?: number;
}): MiddlewareHandler<AppBindings> => {
  return async (c, next) => {
    const auth = getAuth(c);

    const requestedOrgId = c.req.param('orgId') || c.req.param('galleryId');
    if (
      auth.scopes.includes('public_search') ||
      resolveOpenAccessProviderScope(requestedOrgId) === 'nga'
    ) {
      await next();
      return;
    }

    const cost = options.cost ?? 1;
    const quota = Number(c.env.DAILY_FREE_QUERY_LIMIT || 100);
    const principalType = auth.apiKeyId ? 'api_key' : 'user';
    const principalId = auth.apiKeyId || auth.userId;
    const usageDate = new Date().toISOString().slice(0, 10);

    await c.env.DB.prepare(
      `
      INSERT INTO api_usage_daily (principal_type, principal_id, usage_date, used, quota)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(principal_type, principal_id, usage_date) DO UPDATE SET
        quota = excluded.quota,
        updated_at = datetime('now')
      `
    )
      .bind(principalType, principalId, usageDate, quota)
      .run();

    const update = await c.env.DB.prepare(
      `
      UPDATE api_usage_daily
      SET used = used + ?, updated_at = datetime('now')
      WHERE principal_type = ?
        AND principal_id = ?
        AND usage_date = ?
        AND used + ? <= quota
      `
    )
      .bind(cost, principalType, principalId, usageDate, cost)
      .run();

    if (!update.meta.changes) {
      const current = await c.env.DB.prepare(
        `
        SELECT used, quota
        FROM api_usage_daily
        WHERE principal_type = ?
          AND principal_id = ?
          AND usage_date = ?
        `
      )
        .bind(principalType, principalId, usageDate)
        .first<{ used: number; quota: number }>();

      c.header('X-RateLimit-Limit', String(current?.quota ?? quota));
      c.header('X-RateLimit-Remaining', '0');

      return c.json(
        {
          success: false,
          error: {
            code: 'DAILY_QUOTA_EXCEEDED',
            message: `Daily free query limit reached (${current?.quota ?? quota}/day)`,
            details: {
              used: current?.used ?? quota,
              quota: current?.quota ?? quota,
            },
          },
        },
        429
      );
    }

    const usage = await c.env.DB.prepare(
      `
      SELECT used, quota
      FROM api_usage_daily
      WHERE principal_type = ?
        AND principal_id = ?
        AND usage_date = ?
      `
    )
      .bind(principalType, principalId, usageDate)
      .first<{ used: number; quota: number }>();

    const usageEventId = await recordApiUsageEvent(c, {
      queryType: options.queryType,
    });

    c.header('X-RateLimit-Limit', String(usage?.quota ?? quota));
    c.header(
      'X-RateLimit-Remaining',
      String(Math.max((usage?.quota ?? quota) - (usage?.used ?? 0), 0))
    );

    const rollbackUsage = async () => {
      await c.env.DB.prepare(
        `
        UPDATE api_usage_daily
        SET used = CASE WHEN used >= ? THEN used - ? ELSE 0 END,
            updated_at = datetime('now')
        WHERE principal_type = ?
          AND principal_id = ?
          AND usage_date = ?
        `
      )
        .bind(cost, cost, principalType, principalId, usageDate)
        .run();

      await c.env.DB.prepare(
        'DELETE FROM artwork_usage_events WHERE usage_event_id = ?'
      )
        .bind(usageEventId)
        .run();

      await c.env.DB.prepare('DELETE FROM api_usage_events WHERE id = ?')
        .bind(usageEventId)
        .run();
    };

    try {
      await next();
    } catch (error) {
      await rollbackUsage();
      throw error;
    }

    if (c.res.status >= 400) {
      await rollbackUsage();
    }
  };
};

export const recordArtworkResults = async (
  c: Context<AppBindings>,
  results: Array<{
    artworkId: string;
    orgId?: string;
    galleryId?: string;
    rank: number;
    score?: number | null;
    metadata?: Record<string, unknown>;
  }>
) => {
  const usageEventId = c.get('usageEventId');

  if (!usageEventId || results.length === 0) {
    return;
  }

  try {
    await recordArtworkUsageEvents(
      c,
      usageEventId,
      results.map((result) => ({
        ...result,
        interaction: 'result',
      }))
    );
  } catch (error) {
    console.warn('Result telemetry failed; continuing search response', error);
  }
};

export const recordArtworkUsageEvents = async (
  c: Context<AppBindings>,
  usageEventId: string,
  events: Array<{
    artworkId: string;
    orgId?: string;
    galleryId?: string;
    rank?: number | null;
    score?: number | null;
    interaction: ArtworkUsageInteraction;
    metadata?: Record<string, unknown>;
  }>
) => {
  if (!usageEventId || events.length === 0) {
    return;
  }

  await c.env.DB.batch(
    events.map((event) =>
      c.env.DB.prepare(
        `
        INSERT INTO artwork_usage_events (
          id, usage_event_id, artwork_id, org_id, rank, score, interaction, metadata
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).bind(
        generateId(),
        usageEventId,
        event.artworkId,
        event.orgId ||
          event.galleryId ||
          c.req.param('orgId') ||
          c.req.param('galleryId') ||
          null,
        event.rank ?? null,
        event.score ?? null,
        event.interaction,
        JSON.stringify(event.metadata ?? {})
      )
    )
  );
};
