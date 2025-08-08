import { NextRequest, NextResponse } from 'next/server';
import { createRunFromPlan, orchestrateRun } from '../../../../server/runs';
import { getPlanById } from '../../../../server/plan';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { authDisabled } from '../../../../lib/featureFlags';

export async function POST(req: NextRequest) {
  if (!authDisabled) {
    const session = await getServerSession(authOptions as any);
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { planId } = await req.json();
  const plan = getPlanById(planId);
  if (!plan) return NextResponse.json({ error: 'plan not found' }, { status: 404 });
  const runId = createRunFromPlan(plan);
  orchestrateRun(runId, plan);
  return NextResponse.json({ runId });
}
