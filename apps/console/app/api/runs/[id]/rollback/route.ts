import { NextRequest, NextResponse } from 'next/server';
import { getRun } from '../../../../../server/runs';
import { emitRun } from '../../../../../server/events';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 });
  emitRun(run.id, { type: 'log', line: 'Rollback requested by user.' });
  emitRun(run.id, { type: 'log', line: 'Simulating rollback...' });
  emitRun(run.id, { type: 'status', runStatus: 'succeeded', done: true });
  return NextResponse.json({ ok: true });
}
