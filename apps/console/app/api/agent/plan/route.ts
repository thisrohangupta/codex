import { NextRequest, NextResponse } from 'next/server';
import { createPlan } from '../../../../server/plan';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions as any);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { prompt, envId, meta } = await req.json();
  const plan = createPlan(prompt || '', envId, meta);
  return NextResponse.json({ plan });
}
