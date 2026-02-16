import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { AgentRuntimeConfig, OAuthProviderRuntimeConfig } from './config.js';

export type OAuthProvider = 'github' | 'jira';

export interface OAuthTokenRecord {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  obtainedAt: string;
  expiresAt?: string;
  siteUrl?: string;
  cloudId?: string;
}

export interface OAuthTokenStore {
  github?: OAuthTokenRecord;
  jira?: OAuthTokenRecord;
}

export interface OAuthAuthorizationRequest {
  provider: OAuthProvider;
  state: string;
  codeVerifier: string;
  authorizationUrl: string;
}

interface TokenExchangeResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
}

export function beginOAuthAuthorization(
  provider: OAuthProvider,
  config: AgentRuntimeConfig,
): OAuthAuthorizationRequest {
  const providerConfig = getProviderConfig(provider, config);
  if (!providerConfig.clientId || !providerConfig.clientSecret) {
    throw new Error(
      `${provider.toUpperCase()} OAuth client is not configured. Set ${provider.toUpperCase()}_OAUTH_CLIENT_ID and ${provider.toUpperCase()}_OAUTH_CLIENT_SECRET.`,
    );
  }

  const state = toBase64Url(randomBytes(16));
  const codeVerifier = toBase64Url(randomBytes(48));
  const challenge = toBase64Url(createHash('sha256').update(codeVerifier).digest());

  const url = new URL(providerConfig.authorizeUrl);
  url.searchParams.set('client_id', providerConfig.clientId);
  url.searchParams.set('redirect_uri', providerConfig.redirectUri);
  url.searchParams.set('scope', providerConfig.scopes.join(' '));
  url.searchParams.set('state', state);

  if (provider === 'jira') {
    url.searchParams.set('audience', providerConfig.audience ?? 'api.atlassian.com');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return {
    provider,
    state,
    codeVerifier,
    authorizationUrl: url.toString(),
  };
}

export async function completeOAuthAuthorization(
  request: OAuthAuthorizationRequest,
  callbackInput: string,
  config: AgentRuntimeConfig,
): Promise<OAuthTokenRecord> {
  const providerConfig = getProviderConfig(request.provider, config);
  if (!providerConfig.clientId || !providerConfig.clientSecret) {
    throw new Error(`${request.provider} OAuth client is not configured`);
  }

  const callback = parseCallbackInput(callbackInput);
  if (callback.state && callback.state !== request.state) {
    throw new Error(`OAuth state mismatch. Expected ${request.state}, received ${callback.state}`);
  }

  const token = await exchangeAuthorizationCode({
    provider: request.provider,
    providerConfig,
    code: callback.code,
    codeVerifier: request.codeVerifier,
  });

  if (request.provider === 'jira') {
    const resource = await fetchJiraAccessibleResource(token.accessToken);
    if (resource) {
      token.siteUrl = resource.url;
      token.cloudId = resource.id;
    }
  }

  return token;
}

export function readOAuthTokenStore(config: AgentRuntimeConfig): OAuthTokenStore {
  const file = resolveTokenStorePath(config.oauth.tokenStorePath);
  if (!existsSync(file)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as OAuthTokenStore;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function writeOAuthTokenStore(config: AgentRuntimeConfig, store: OAuthTokenStore): void {
  const file = resolveTokenStorePath(config.oauth.tokenStorePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export function saveOAuthToken(
  provider: OAuthProvider,
  token: OAuthTokenRecord,
  config: AgentRuntimeConfig,
): void {
  const store = readOAuthTokenStore(config);
  if (provider === 'github') {
    store.github = token;
  } else {
    store.jira = token;
  }
  writeOAuthTokenStore(config, store);
}

export function resolveTokenStorePath(tokenStorePath: string): string {
  if (isAbsolute(tokenStorePath)) {
    return tokenStorePath;
  }
  return resolve(process.cwd(), tokenStorePath);
}

export function maskToken(token: string): string {
  if (token.length <= 10) {
    return `${token.slice(0, 2)}...${token.slice(-2)}`;
  }
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export function hasValidToken(token: OAuthTokenRecord | undefined): boolean {
  if (!token?.accessToken) {
    return false;
  }

  if (!token.expiresAt) {
    return true;
  }

  return new Date(token.expiresAt).getTime() > Date.now() + 60_000;
}

interface ExchangeRequest {
  provider: OAuthProvider;
  providerConfig: OAuthProviderRuntimeConfig;
  code: string;
  codeVerifier: string;
}

async function exchangeAuthorizationCode(request: ExchangeRequest): Promise<OAuthTokenRecord> {
  const { provider, providerConfig, code, codeVerifier } = request;
  if (!providerConfig.clientSecret || !providerConfig.clientId) {
    throw new Error('OAuth client credentials are required for token exchange');
  }

  const tokenUrl = providerConfig.tokenUrl;
  const response =
    provider === 'github'
      ? await exchangeGithubToken(tokenUrl, {
          clientId: providerConfig.clientId,
          clientSecret: providerConfig.clientSecret,
          code,
          redirectUri: providerConfig.redirectUri,
        })
      : await exchangeJiraToken(tokenUrl, {
          clientId: providerConfig.clientId,
          clientSecret: providerConfig.clientSecret,
          code,
          redirectUri: providerConfig.redirectUri,
          codeVerifier,
        });

  if (!response.access_token) {
    throw new Error(`${provider} token exchange did not return access_token`);
  }

  const token: OAuthTokenRecord = {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenType: response.token_type,
    scope: response.scope,
    obtainedAt: new Date().toISOString(),
  };

  if (typeof response.expires_in === 'number') {
    token.expiresAt = new Date(Date.now() + response.expires_in * 1000).toISOString();
  }

  return token;
}

async function exchangeGithubToken(
  tokenUrl: string,
  payload: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  },
): Promise<TokenExchangeResponse> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: payload.clientId,
      client_secret: payload.clientSecret,
      code: payload.code,
      redirect_uri: payload.redirectUri,
    }),
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${JSON.stringify(body)}`);
  }

  return body as TokenExchangeResponse;
}

async function exchangeJiraToken(
  tokenUrl: string,
  payload: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  },
): Promise<TokenExchangeResponse> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: payload.clientId,
      client_secret: payload.clientSecret,
      code: payload.code,
      redirect_uri: payload.redirectUri,
      code_verifier: payload.codeVerifier,
    }),
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Jira token exchange failed: ${JSON.stringify(body)}`);
  }

  return body as TokenExchangeResponse;
}

async function fetchJiraAccessibleResource(
  accessToken: string,
): Promise<{ id: string; url: string } | undefined> {
  const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Failed to fetch Jira accessible resources: ${JSON.stringify(body)}`);
  }

  if (!Array.isArray(body)) {
    return undefined;
  }

  const first = body.find((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const record = item as Record<string, unknown>;
    return typeof record.id === 'string' && typeof record.url === 'string';
  }) as Record<string, string> | undefined;

  if (!first) {
    return undefined;
  }

  return { id: first.id, url: first.url };
}

function parseCallbackInput(input: string): { code: string; state?: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('OAuth callback input is required');
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') ?? undefined;
    if (!code) {
      throw new Error('Callback URL does not include a code query parameter');
    }
    return { code, state };
  }

  return { code: trimmed };
}

function getProviderConfig(
  provider: OAuthProvider,
  config: AgentRuntimeConfig,
): OAuthProviderRuntimeConfig {
  return provider === 'github' ? config.oauth.github : config.oauth.jira;
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}
