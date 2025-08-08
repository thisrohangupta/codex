import { NextRequest, NextResponse } from 'next/server';
import { createEnv, listEnvs } from '../../../server/env';

export async function GET() {
  return NextResponse.json({ environments: listEnvs() });
}

export async function POST(req: NextRequest) {
  const { name, provider, target, region } = await req.json();
  const env = createEnv({ name, provider, target, region });
  return NextResponse.json({ environment: env });
}

