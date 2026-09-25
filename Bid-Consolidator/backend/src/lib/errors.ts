// Typed HTTP errors. Services throw these; the central error handler turns them
// into responses. Anything that is NOT an AppError is treated as an internal
// failure: logged in full, returned to the client as a generic 500 (no SQL,
// stack traces or file paths ever leak).
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, message, 'bad_request', details);
export const unauthorized = (message = 'Please sign in') => new AppError(401, message, 'unauthorized');
export const forbidden = (message = 'You do not have access to this') => new AppError(403, message, 'forbidden');
export const notFound = (what = 'Resource') => new AppError(404, `${what} not found`, 'not_found');
export const conflict = (message: string, details?: unknown) => new AppError(409, message, 'conflict', details);
export const gone = (message: string) => new AppError(410, message, 'gone');
export const tooLarge = (message: string) => new AppError(413, message, 'too_large');
export const unavailable = (message: string) => new AppError(503, message, 'unavailable');

/** Postgres unique-violation → 409 with a friendly message. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}
/** Postgres foreign-key violation. */
export function isForeignKeyViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23503';
}
