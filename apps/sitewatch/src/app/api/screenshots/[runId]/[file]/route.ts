import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { screenshotsDir } from '@/lib/checker/crawl';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; file: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { runId, file } = await params;
  // Path traversal guard: both segments must stay plain names.
  if (!/^[a-z0-9-]+$/i.test(runId) || !/^[a-z0-9._-]+\.png$/i.test(file)) {
    return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  }

  try {
    const data = await readFile(path.join(screenshotsDir(), runId, file));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'private, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
