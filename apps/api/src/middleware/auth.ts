import type { Context, MiddlewareHandler, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../index';
import { generateId, generateToken, hashApiKey } from '../utils/crypto';

export type PrincipalKind = 'user' | 'api_key';

export interface AuthPrincipal {
  kind: PrincipalKind;
  userId: string;
  email?: string;
  name?: string;
  apiKeyId?: string;
  scopes: string[];
}

type Variables = {
  auth: AuthPrincipal;
  usageEventId: string;
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
    return { name: 'curl', version: userAgent.match(/curl\/([\d.]+)/)?.[1] ?? null };
  }

  if (/python-requests/i.test(userAgent)) {
    return { name: 'python-requests', version: userAgent.match(/python-requests\/([\d.]+)/)?.[1] ?? null };
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

const getDeviceType = (userAgent: string | null, secChUaMobile: string | null) => {
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
    ipAddress: truncate(c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For'), 128),
    userAgent,
    browserName: browser.name,
    browserVersion: browser.version,
    osName: os.name,
    osVersion: os.version,
    deviceType: getDeviceType(userAgent, secChUaMobile),
    country: toStringOrNull(cf.country) || truncate(c.req.header('CF-IPCountry'), 16),
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

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    ...(audience ? { audience } : {}),
  });

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

const verifyPersonalApiKey = async (c: Context<AppBindings>, apiKey: string) => {
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

  await c.env.DB.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?')
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

const getApiKeyFromRequest = (c: Context<AppBindings>, bearerToken: string | null) => {
  const explicitKey = c.req.header('X-API-Key');
  if (explicitKey) {
    return explicitKey.trim();
  }

  if (bearerToken?.startsWith('plt_')) {
    return bearerToken;
  }

  return null;
};

const getDevPrincipal = (c: Context<AppBindings>) => {
  if (c.env.ENVIRONMENT === 'production') {
    return null;
  }

  const userId = c.req.header('X-User-Id');
  if (!userId) {
    return null;
  }

  return {
    kind: 'user',
    userId,
    email: c.req.header('X-User-Email') || `${userId}@dev.local`,
    name: c.req.header('X-User-Name') || userId,
    scopes: ['dev'],
  } satisfies AuthPrincipal;
};

export const requireLogtoUser = async (c: Context<AppBindings>, next: Next) => {
  try {
    const bearerToken = getBearerToken(c.req.header('Authorization'));
    const devPrincipal = getDevPrincipal(c);
    const auth = bearerToken ? await verifyLogtoToken(c, bearerToken) : devPrincipal;

    if (!auth || auth.kind !== 'user') {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Logto sign-in required',
          },
        },
        401
      );
    }

    await ensureUser(c, auth);
    c.set('auth', auth);
    await next();
  } catch (error) {
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

export const requireAuthOrApiKey = async (c: Context<AppBindings>, next: Next) => {
  try {
    const bearerToken = getBearerToken(c.req.header('Authorization'));
    const apiKey = getApiKeyFromRequest(c, bearerToken);

    const auth =
      (apiKey ? await verifyPersonalApiKey(c, apiKey) : null) ||
      (bearerToken && !bearerToken.startsWith('plt_')
        ? await verifyLogtoToken(c, bearerToken)
        : null) ||
      getDevPrincipal(c);

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

    c.set('auth', auth);
    await next();
  } catch (error) {
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

export const enforceDailyQuota = (
  options: { queryType: string; cost?: number }
): MiddlewareHandler<AppBindings> => {
  return async (c, next) => {
    const auth = getAuth(c);
    const cost = options.cost ?? 1;
    const quota = Number(c.env.DAILY_FREE_QUERY_LIMIT || 100);
    const principalType = auth.apiKeyId ? 'api_key' : 'user';
    const principalId = auth.apiKeyId || auth.userId;
    const usageDate = new Date().toISOString().slice(0, 10);

    await c.env.DB.prepare(
      `
      INSERT INTO api_usage_daily (principal_type, principal_id, usage_date, used, quota)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(principal_type, principal_id, usage_date) DO NOTHING
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

    const usageEventId = generateId();
    const requestMetadata = getRequestMetadata(c);
    await c.env.DB.prepare(
      `
      INSERT INTO api_usage_events (
        id, user_id, api_key_id, usage_date, method, path, route, query_type,
        gallery_id, collection_id, auth_kind, ip_address, user_agent,
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
        options.queryType,
        c.req.param('galleryId') || null,
        c.req.param('collectionId') || null,
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
        requestMetadata.metadata
      )
      .run();

    c.set('usageEventId', usageEventId);
    c.header('X-RateLimit-Limit', String(usage?.quota ?? quota));
    c.header('X-RateLimit-Remaining', String(Math.max((usage?.quota ?? quota) - (usage?.used ?? 0), 0)));

    await next();
  };
};

export const recordArtworkResults = async (
  c: Context<AppBindings>,
  results: Array<{ artworkId: string; galleryId?: string; rank: number; score?: number | null }>
) => {
  const usageEventId = c.get('usageEventId');

  if (!usageEventId || results.length === 0) {
    return;
  }

  await c.env.DB.batch(
    results.map((result) =>
      c.env.DB.prepare(
        `
        INSERT INTO artwork_usage_events (
          id, usage_event_id, artwork_id, gallery_id, rank, score, interaction
        )
        VALUES (?, ?, ?, ?, ?, ?, 'result')
        `
      ).bind(
        generateId(),
        usageEventId,
        result.artworkId,
        result.galleryId || c.req.param('galleryId') || null,
        result.rank,
        result.score ?? null
      )
    )
  );
};
