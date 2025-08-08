// Optional Prisma-backed store. If @prisma/client is available and DATABASE_URL is set, use it; otherwise noop.
export async function available() {
  return !!process.env.DATABASE_URL;
}

export type PrismaClientLike = any;

export async function getClient(): Promise<PrismaClientLike | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/client');
    const client = new PrismaClient();
    return client;
  } catch {
    return null;
  }
}

