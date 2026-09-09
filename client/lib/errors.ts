import { NextResponse } from 'next/server';

/**
 * Central error -> HTTP response mapper for the API route handlers. Call it
 * from a route's `catch` block so error handling lives in one place:
 *
 *   try {
 *     ...
 *   } catch (err) {
 *     return handleError(err);
 *   }
 *
 * Everything that can fail throws one of the AppError subclasses below, and
 * this is the only place that decides a status code. Route handlers never
 * build an error response themselves.
 */

/** Field-level detail attached to a validation failure. */
export interface ErrorDetail {
  field: string;
  message: string;
}

/**
 * Base class for failures we expect and can safely describe to the caller.
 * Anything that is not one of these is treated as a bug and hidden
 * behind a generic 500.
 *
 * `code` is a stable, machine-readable string that clients branch on, so the
 * human-readable `message` can be reworded without breaking them.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(
    message: string,
    status: number,
    code: string,
    details?: ErrorDetail[]
  ) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * The caller sent something we cannot accept - a body that is not valid JSON,
 * not an object, or does not match the schema. See `lib/validation.ts` for the
 * checks themselves.
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 400, 'VALIDATION_FAILED', details);
  }
}

/**
 * No such record. Also the answer for an id that isn't a positive integer -
 * `abc` and `-1` can't name a row, so "not found" is the honest reply.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Restaurant not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

/** Valid input that clashes with what's already stored. */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * PostgreSQL SQLSTATE codes.
 *
 * Two different jobs here. Most rows should be caught by other validations before this.
 * If 23502 or 23514 ever fires it means the schema constrains something the API does not check.
 *
 * 23505 is different and is expected to fire. Uniqueness cannot be checked in
 * application code. Only the database can check, and only at write time.
 */

const POSTGRES_ERRORS: Record<
  string,
  { status: number; code: string; message: string }
> = {
  // unique_violation
  '23505': { status: 409, code: 'CONFLICT', message: 'That record already exists' },
  // not_null_violation
  '23502': { status: 400, code: 'VALIDATION_FAILED', message: 'A required field was missing' },
  // check_violation
  '23514': { status: 400, code: 'VALIDATION_FAILED', message: 'A field was outside its allowed range' },
  // foreign_key_violation
  '23503': { status: 409, code: 'CONFLICT', message: 'That record is referenced by other data' },
  // invalid_text_representation - e.g. 'abc' cast to integer
  '22P02': { status: 404, code: 'NOT_FOUND', message: 'Restaurant not found' },
  // numeric_value_out_of_range
  '22003': { status: 404, code: 'NOT_FOUND', message: 'Restaurant not found' },
};

/** Extracts SQLSTATE code from unknown throw error, return null if nothing was found */
function postgresCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  const code = (err as { code: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * The only place a status code is chosen. Turns any thrown value into a JSON response
 */
export function handleError(err: unknown): NextResponse {
  // Expected failures: the status was decided where the error was thrown.
  if (err instanceof AppError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        ...(err.details && { details: err.details }),
      },
      { status: err.status }
    );
  }

  // Check for SQLSTATE errors that are matched  
  const mapped = POSTGRES_ERRORS[postgresCode(err) ?? ''];
  if (mapped) {
    return NextResponse.json(
      { error: mapped.message, code: mapped.code },
      { status: mapped.status }
    );
  }

  // Unexpected: log the real error, tell the client nothing about it.
  console.error('Unhandled API error:', err);
  return NextResponse.json(
    { error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
    { status: 500 }
  );
}
