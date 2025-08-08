import { NextRequest, NextResponse } from 'next/server';
import { listApprovals, requestApproval } from '../../../server/approvals';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { authDisabled } from '../../../lib/featureFlags';

export async function GET() {
  return NextResponse.json({ approvals: listApprovals() });
}

export async function POST(req: NextRequest) {
  const { planId } = await req.json();
  if (authDisabled) {
    const approval = requestApproval(planId, 'tester');
    return NextResponse.json({ approval });
  }
  const session = await getServerSession(authOptions as any);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const approval = requestApproval(planId, session.user?.email || 'unknown');
  return NextResponse.json({ approval });
}
