import { Pool } from 'pg';

const pools = new Map<string, Pool>();

export function createSharedPgPool(connectionString: string): Pool {
  const existing = pools.get(connectionString);
  if (existing) {
    return existing;
  }

  const pool = new Pool({ connectionString });
  pools.set(connectionString, pool);
  return pool;
}

export function assertSqlIdentifier(input: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input)) {
    throw new Error(`${label} is not a valid SQL identifier: ${input}`);
  }
  return input;
}

export function quoteIdentifier(input: string): string {
  const safe = assertSqlIdentifier(input, 'identifier');
  return `"${safe}"`;
}

export function toIso(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const text = String(value);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}
