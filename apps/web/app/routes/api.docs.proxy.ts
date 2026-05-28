import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getApiBaseUrl, getServerEnv } from '~/lib/public-search.server';

type ProxyField = {
  name: string;
  type: 'File' | 'boolean' | 'integer' | 'number' | 'string' | 'string[]';
  required?: boolean;
};

type ProxyEndpoint = {
  method: 'GET' | 'POST';
  path: string;
  public?: boolean;
  fields: ProxyField[];
};

type DocsApiEnvironment = 'stg' | 'prod';

const apiBaseByEnvironment: Record<DocsApiEnvironment, string> = {
  stg: 'https://paillette-api-stg.berlayar.ai/api/v1',
  prod: 'https://paillette-api.berlayar.ai/api/v1',
};

const endpoints: ProxyEndpoint[] = [
  {
    method: 'GET',
    path: '/orgs',
    public: true,
    fields: [{ name: 'limit', type: 'integer' }],
  },
  {
    method: 'GET',
    path: '/orgs/slug/{slug}',
    public: true,
    fields: [{ name: 'slug', type: 'string', required: true }],
  },
  {
    method: 'POST',
    path: '/orgs/ngs/search/text',
    fields: [
      { name: 'query', type: 'string', required: true },
      { name: 'topK', type: 'integer' },
      { name: 'minScore', type: 'number' },
    ],
  },
  {
    method: 'POST',
    path: '/orgs/ngs/search/image',
    fields: [
      { name: 'image', type: 'File', required: true },
      { name: 'topK', type: 'integer' },
      { name: 'minScore', type: 'number' },
    ],
  },
  {
    method: 'POST',
    path: '/orgs/ngs/search/color',
    fields: [
      { name: 'colors', type: 'string[]', required: true },
      { name: 'matchMode', type: 'string' },
      { name: 'threshold', type: 'number' },
      { name: 'limit', type: 'integer' },
    ],
  },
  {
    method: 'GET',
    path: '/orgs/ngs/artworks/{artworkId}',
    fields: [{ name: 'artworkId', type: 'string', required: true }],
  },
  {
    method: 'POST',
    path: '/translate/text',
    fields: [
      { name: 'text', type: 'string', required: true },
      { name: 'sourceLang', type: 'string', required: true },
      { name: 'targetLang', type: 'string', required: true },
    ],
  },
  {
    method: 'POST',
    path: '/extract',
    fields: [
      { name: 'imageUrls', type: 'string[]', required: true },
      { name: 'target', type: 'string' },
      { name: 'preserveFilenames', type: 'boolean' },
      { name: 'filenamePrefix', type: 'string' },
      { name: 'filenameSuffix', type: 'string' },
      { name: 'preview', type: 'boolean' },
    ],
  },
];

const coerce = (field: ProxyField, value: unknown) => {
  if (value == null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;

  if (field.type === 'integer') {
    const parsed = Number.parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : text;
  }

  if (field.type === 'number') {
    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? parsed : text;
  }

  if (field.type === 'string[]') {
    return text
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (field.type === 'boolean') {
    return ['1', 'true', 'yes', 'on'].includes(text.toLowerCase());
  }

  return text;
};

const isPathField = (endpoint: ProxyEndpoint, field: ProxyField) =>
  endpoint.path.includes(`{${field.name}}`);

const getFieldLocation = (endpoint: ProxyEndpoint, field: ProxyField) => {
  if (isPathField(endpoint, field)) return 'path';
  if (endpoint.method === 'GET') return 'query';
  return endpoint.fields.some((candidate) => candidate.type === 'File')
    ? 'form'
    : 'body';
};

const proxyError = (message: string, status = 400) =>
  json(
    {
      success: false,
      error: { code: 'DOCS_PROXY_ERROR', message },
    },
    { status }
  );

const normalizeApiEnv = (value: unknown): DocsApiEnvironment | undefined =>
  value === 'stg' || value === 'prod' ? value : undefined;

const getDocsApiBaseUrl = (
  context: ActionFunctionArgs['context'],
  apiEnv: DocsApiEnvironment | undefined
) =>
  apiEnv ? apiBaseByEnvironment[apiEnv] : getApiBaseUrl(getServerEnv(context));

export const action = async ({ context, request }: ActionFunctionArgs) => {
  const contentType = request.headers.get('content-type') ?? '';
  const isMultipart = contentType.includes('multipart/form-data');
  let endpointPath = '';
  let apiKey = '';
  let apiEnv: DocsApiEnvironment | undefined;
  let values: Record<string, unknown> = {};
  let incomingForm: FormData | null = null;

  if (isMultipart) {
    incomingForm = await request.formData();
    endpointPath = String(incomingForm.get('_endpointPath') ?? '');
    apiKey = String(incomingForm.get('_apiKey') ?? '');
    apiEnv = normalizeApiEnv(incomingForm.get('_apiEnv'));
    values = Object.fromEntries(incomingForm.entries());
  } else {
    const body = (await request.json().catch(() => null)) as {
      apiEnv?: unknown;
      apiKey?: string;
      endpointPath?: string;
      values?: Record<string, unknown>;
    } | null;
    endpointPath = body?.endpointPath ?? '';
    apiKey = body?.apiKey ?? '';
    apiEnv = normalizeApiEnv(body?.apiEnv);
    values = body?.values ?? {};
  }

  const endpoint = endpoints.find(
    (candidate) => candidate.path === endpointPath
  );
  if (!endpoint) return proxyError('Unsupported docs endpoint.');
  if (!endpoint.public && !apiKey.trim()) {
    return proxyError('API key is required for this endpoint.', 401);
  }

  const path = endpoint.path.replace(/\{([^}]+)\}/g, (_, fieldName: string) => {
    const value = values[fieldName];
    return encodeURIComponent(String(value ?? fieldName));
  });
  const url = new URL(`${getDocsApiBaseUrl(context, apiEnv)}${path}`);
  const headers = new Headers();
  let body: BodyInit | undefined;

  if (!endpoint.public) {
    headers.set('X-API-Key', apiKey.trim());
  }

  const jsonBody: Record<string, unknown> = {};
  const formBody = endpoint.fields.some((field) => field.type === 'File')
    ? new FormData()
    : null;

  for (const field of endpoint.fields) {
    const location = getFieldLocation(endpoint, field);
    if (location === 'path') continue;

    if (location === 'query') {
      const value = coerce(field, values[field.name]);
      if (value !== undefined) url.searchParams.set(field.name, String(value));
      continue;
    }

    if (location === 'form') {
      if (field.type === 'File') {
        const file = incomingForm?.get(field.name);
        if (!(file instanceof File)) {
          if (field.required) return proxyError(`${field.name} is required.`);
          continue;
        }
        formBody?.set(field.name, file);
        continue;
      }

      const value = coerce(field, values[field.name]);
      if (value !== undefined) formBody?.set(field.name, String(value));
      continue;
    }

    const value = coerce(field, values[field.name]);
    if (value !== undefined) jsonBody[field.name] = value;
  }

  if (endpoint.method === 'POST') {
    if (formBody) {
      body = formBody;
    } else {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(jsonBody);
    }
  }

  const response = await fetch(url, {
    method: endpoint.method,
    headers,
    body,
  });
  const responseHeaders = new Headers();
  responseHeaders.set(
    'Content-Type',
    response.headers.get('content-type') ?? 'application/json'
  );

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
};
