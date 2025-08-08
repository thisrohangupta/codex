import { NextRequest, NextResponse } from 'next/server';
import { deny } from '../../../../../server/approvals';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions as any);
  const role = (session as any)?.role || 'developer';
  const name = session?.user?.email || 'unknown';
  if (role !== 'admin') return new Response('forbidden', { status: 403 });
  const res = deny(params.id, name);
  if (!res) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ approval: res });
}
