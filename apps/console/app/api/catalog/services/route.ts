import { NextResponse } from 'next/server';
import { services } from '../../../../server/catalog';

export async function GET() {
  return NextResponse.json({ services });
}

