// Supabase/PostgREST errors are plain objects ({message, details, hint,
// code}), not Error instances, so `err instanceof Error` misses them and
// String(err) collapses them to the useless "[object Object]". This pulls
// out something readable from whatever shape an error actually is.
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const withMessage = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts = [withMessage.message, withMessage.details, withMessage.hint]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (parts.length > 0) {
      return withMessage.code ? `${parts.join(' — ')} (${withMessage.code})` : parts.join(' — ')
    }
    try {
      return JSON.stringify(err)
    } catch {
      // fall through
    }
  }
  return String(err)
}
