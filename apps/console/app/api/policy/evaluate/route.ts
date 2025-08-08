import { NextRequest, NextResponse } from 'next/server';
import { getPlanById } from '../../../../server/plan';
import { evaluatePlan, evaluateWithConftest } from '../../../../server/policy';

export async function POST(req: NextRequest) {
  const { planId } = await req.json();
  const plan = getPlanById(planId);
  if (!plan) return NextResponse.json({ error: 'plan not found' }, { status: 404 });
  const base = evaluatePlan(plan);
  const conf = await evaluateWithConftest(plan);
  if (!conf) return NextResponse.json(base);
  const allow = base.allow && conf.allow;
  const findings = [...base.findings, ...conf.findings];
  return NextResponse.json({ allow, findings });
}
