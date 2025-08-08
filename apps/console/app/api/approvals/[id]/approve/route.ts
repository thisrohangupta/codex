import { NextRequest, NextResponse } from 'next/server';
import { approve } from '../../../../../server/approvals';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth';
import { authDisabled } from '../../../../../lib/featureFlags';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (authDisabled) {
    const res = approve(params.id, 'tester');
    if (!res) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ approval: res });
  }
  const session = await getServerSession(authOptions as any);
  const role = (session as any)?.role || 'developer';
  const name = session?.user?.email || 'unknown';
  if (role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const res = approve(params.id, name);
  if (!res) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ approval: res });
}
