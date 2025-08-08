import { NextResponse } from 'next/server';
import { services } from '../../../../server/catalog';

export async function GET() {
  return NextResponse.json(
    { services },
    {
      headers: {
        // Cache for 5 minutes; allow stale while revalidating
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      },
    }
  );
}
