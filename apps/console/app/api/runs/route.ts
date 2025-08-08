import { NextResponse } from 'next/server';
import { listRuns } from '../../../server/runs';

export async function GET() {
  return NextResponse.json({ runs: listRuns() });
}

