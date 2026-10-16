export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const INTERNAL_ERROR = 'Erreur interne, réessaie.';

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Runs a repo operation; unexpected exceptions are logged and mapped to a generic French error. */
export async function guarded<T>(label: string, run: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await run();
  } catch (error) {
    console.error(`[${label}]`, error);
    return fail(INTERNAL_ERROR);
  }
}
