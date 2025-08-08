import { NextRequest } from 'next/server';
import { getRun, startRunStreaming } from '../../../../../server/runs';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) return new Response('not found', { status: 404 });

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: any) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`));
      const stop = () => controller.close();
      startRunStreaming(run.id, send, stop);
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}

