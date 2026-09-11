import { NextResponse } from 'next/server';
import { pool } from '@/db/pool';

/**
 * GET /api/health/ready
 * Readiness: can this instance actually serve traffic right now?
 *
 * Distinct from /api/health, which is a liveness check - it answers "is the
 * process running" and deliberately touches nothing, so it stays up while
 * dependencies are down. Readiness answers the different question "should
 * traffic be sent here", which means checking what a request actually needs.
 *
 * The distinction matters operationally. A load balancer or orchestrator pulls
 * an instance out of rotation when readiness fails, but restarts it when
 * liveness fails. Conflating them means either restarting a healthy process
 * because the database blinked, or - the case here before this route existed -
 * answering "ok" while Postgres is unreachable, so traffic keeps arriving at an
 * instance that cannot serve a single query.
 *
 * SELECT 1 is the whole check: it proves a connection can be acquired from the
 * pool and that the server answers. It reads no table, so it costs nothing and
 * cannot be affected by the data.
 */
export async function GET() {
  try {
    await pool.query('SELECT 1');
    return NextResponse.json({ status: 'ready', database: 'up' });
  } catch (err) {
    // Deliberately not handleError(). Every other route funnels there so status
    // codes are decided in one place, but a probe has exactly one failure mode
    // and one correct answer: 503, meaning "not me, try another instance".
    // Through the generic mapper a dependency outage becomes a 500, which reads
    // as "this instance is broken" and gets it restarted rather than withdrawn
    // from rotation.
    console.error('Readiness check failed:', err);
    return NextResponse.json(
      { status: 'unavailable', database: 'down' },
      { status: 503 }
    );
  }
}
