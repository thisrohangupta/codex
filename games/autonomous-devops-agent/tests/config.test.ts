import { readRuntimeConfig } from '../src/config.js';
import { assertEqual, assertTrue } from './test-helpers.js';

export async function runConfigTests(): Promise<void> {
  testAdapterFallbackKeyParsing();
  testAdapterJsonKeyParsing();
  testStorageAndQueueParsing();
}

function testAdapterFallbackKeyParsing(): void {
  const config = readRuntimeConfig({
    ADAPTER_AUTH_MODE: 'api-key',
    ADAPTER_API_KEY: 'dev-admin-key',
  });

  assertEqual(config.adapter.auth.mode, 'api-key', 'adapter auth mode should be parsed');
  assertEqual(config.adapter.auth.keys.length, 1, 'fallback key should be parsed');
  assertEqual(config.adapter.auth.keys[0].roles.includes('admin'), true, 'fallback key should be admin role');
}

function testAdapterJsonKeyParsing(): void {
  const config = readRuntimeConfig({
    ADAPTER_AUTH_MODE: 'api-key',
    ADAPTER_AUTH_KEYS_JSON: JSON.stringify([
      { id: 'ui', key: 'ui-key', roles: ['viewer', 'operator'] },
      { id: 'approver', key: 'apr-key', roles: ['approver'] },
    ]),
  });

  assertEqual(config.adapter.auth.keys.length, 2, 'json key list should be parsed');
  const ui = config.adapter.auth.keys.find((entry) => entry.id === 'ui');
  assertTrue(Boolean(ui), 'ui key should exist');
  assertEqual(ui?.roles.includes('operator'), true, 'ui key should include operator role');
}

function testStorageAndQueueParsing(): void {
  const config = readRuntimeConfig({
    DATASTORE_DRIVER: 'postgres',
    DATABASE_URL: 'postgres://localhost:5432/agent',
    DATABASE_SCHEMA: 'agentic',
    QUEUE_RUN_TIMEOUT_MS: '0',
    QUEUE_LEASE_MS: '45000',
    QUEUE_HEARTBEAT_INTERVAL_MS: '5000',
  });

  assertEqual(config.storage.driver, 'postgres', 'storage driver should be postgres');
  assertEqual(config.storage.schema, 'agentic', 'storage schema should be parsed');
  assertEqual(config.queue.runTimeoutMs, 0, 'run timeout should allow disabling with 0');
  assertEqual(config.queue.leaseMs, 45000, 'lease ms should parse from env');
  assertEqual(config.queue.heartbeatIntervalMs, 5000, 'heartbeat interval should parse from env');
}
