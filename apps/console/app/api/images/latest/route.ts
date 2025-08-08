import { NextRequest, NextResponse } from 'next/server';
import { getLatestTag } from '../../../../server/images';

export async function GET(req: NextRequest) {
  const imageRepo = req.nextUrl.searchParams.get('repo');
  if (!imageRepo) return NextResponse.json({ error: 'repo required' }, { status: 400 });
  const tag = await getLatestTag(imageRepo);
  return NextResponse.json({ repo: imageRepo, tag });
}

