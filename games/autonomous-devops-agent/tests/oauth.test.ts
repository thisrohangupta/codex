import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRuntimeConfig } from '../src/config.js';
import {
  hasValidToken,
  readOAuthTokenStore,
  resolveTokenStorePath,
  saveOAuthToken,
} from '../src/oauth.js';
import { assertEqual, assertTrue } from './test-helpers.js';

export async function runOAuthTests(): Promise<void> {
  testOAuthTokenStoreRoundTrip();
  testTokenValidityChecks();
}

function testOAuthTokenStoreRoundTrip(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-oauth-store-'));
  const tokenStorePath = join(tempDir, 'tokens.json');

  const config = readRuntimeConfig({ OAUTH_TOKEN_STORE_PATH: tokenStorePath });

  saveOAuthToken(
    'github',
    {
      accessToken: 'gho_local_token_1234',
      obtainedAt: new Date().toISOString(),
    },
    config,
  );

  const store = readOAuthTokenStore(config);
  assertEqual(
    store.github?.accessToken,
    'gho_local_token_1234',
    'github access token should persist in token store',
  );
  assertTrue(
    resolveTokenStorePath(config.oauth.tokenStorePath) === tokenStorePath,
    'token store path resolution should use absolute path when provided',
  );

  rmSync(tempDir, { recursive: true, force: true });
}

function testTokenValidityChecks(): void {
  const valid = hasValidToken({
    accessToken: 'abc123',
    obtainedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  assertTrue(valid, 'future expiry should be considered valid');

  const expired = hasValidToken({
    accessToken: 'abc123',
    obtainedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  assertEqual(expired, false, 'past expiry should be considered invalid');
}
