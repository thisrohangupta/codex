import { NextResponse } from 'next/server';
import { listAudits } from '../../../server/audit';

export async function GET() {
  return NextResponse.json({ audits: listAudits() });
}

