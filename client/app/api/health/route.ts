import { NextResponse } from 'next/server';

/**
 * GET /api/health
 * Simple liveness check. Does not touch the database.
 */
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
