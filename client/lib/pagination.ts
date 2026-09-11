/**
 * Keyset pagination for the restaurant list.
 *
 * Why keyset rather than LIMIT/OFFSET. Offset counts positions, and positions
 * move: insert a restaurant while a client sits between page one and page two
 * and every later row shifts down, so "skip 20" now skips a different 20 - the
 * client sees one record twice, or never sees it at all. Keyset says "continue
 * after this specific record" instead of counting, and that record does not
 * move. (Offset also walks and discards every skipped row, which matters at
 * depth, but the correctness bug is the reason: it is reproducible at five rows,
 * where the performance difference is not.)
 *
 * The tradeoff: keyset only goes forward. There is no jumping to page 7, since
 * you cannot know page 6's last row without reading pages 1-6. Right for a feed
 * or infinite scroll, wrong for numbered page buttons.
 *
 * The cursor is opaque on purpose - clients pass back what we gave them rather
 * than building one, so the sort key can change without breaking them.
 */
import { z } from 'zod';
import { ValidationError, type ErrorDetail } from './errors';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Query parameters arrive as strings, so coercion is right here - unlike a JSON
 * body, where a numeric field sent as "4.5" means the client got it wrong. The
 * medium has no numbers to preserve, so there is nothing to be strict about.
 */
const paginationSchema = z.strictObject({
  limit: z.coerce
    .number()
    .int('limit must be a whole number')
    .min(1, 'limit must be at least 1')
    .max(MAX_LIMIT, `limit must be at most ${MAX_LIMIT}`)
    .default(DEFAULT_LIMIT),
  after: z.string().min(1).optional(),
});

/** Where the next page starts: the sort key of the last row the client saw. */
export interface Cursor {
  createdAt: string;
  id: number;
}

export interface PageRequest {
  limit: number;
  after?: Cursor;
}

/**
 * `<ISO timestamp>|<id>`, base64url encoded. Both halves are needed because the
 * sort is (created_at DESC, id DESC) - the id breaks ties so the ordering is
 * total, without which two rows sharing a timestamp could be skipped or
 * repeated across a page boundary.
 */
export function encodeCursor(createdAt: string, id: number): string {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  const invalid = () =>
    new ValidationError('Invalid pagination cursor', [
      { field: 'after', message: 'not a cursor returned by this endpoint' },
    ]);

  const decoded = Buffer.from(raw, 'base64url').toString('utf8');

  const separator = decoded.lastIndexOf('|');
  if (separator === -1) throw invalid();

  const createdAt = decoded.slice(0, separator);
  const id = Number(decoded.slice(separator + 1));

  if (!Number.isInteger(id) || id < 1) throw invalid();
  if (Number.isNaN(Date.parse(createdAt))) throw invalid();

  return { createdAt, id };
}

/** Read `?limit=` and `?after=`, or throw a 400 describing what was wrong. */
export function parsePageRequest(url: URL): PageRequest {
  const raw = Object.fromEntries(url.searchParams);
  const result = paginationSchema.safeParse(raw);

  if (!result.success) {
    const details: ErrorDetail[] = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(query)',
      message: issue.message,
    }));
    throw new ValidationError('Invalid pagination parameters', details);
  }

  const { limit, after } = result.data;
  return { limit, after: after ? decodeCursor(after) : undefined };
}

/**
 * An RFC 8288 Link header, the way GitHub paginates.
 *
 * The metadata rides in a header rather than wrapping the body in an envelope
 * because the API contract fixes this endpoint's response as a JSON array.
 * Wrapping it would have been the more obvious design and would have broken
 * that contract; a Link header keeps both.
 */
export function nextLinkHeader(url: URL, limit: number, cursor: string): string {
  const next = new URL(url.toString());
  next.searchParams.set('limit', String(limit));
  next.searchParams.set('after', cursor);
  return `<${next.toString()}>; rel="next"`;
}
