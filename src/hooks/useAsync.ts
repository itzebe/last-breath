import { useCallback, useEffect, useRef, useState } from 'react';
import { toAppError, type AppError } from '@/lib/errors';

export interface AsyncState<T> {
  data: T | null;
  error: AppError | null;
  loading: boolean;
}

/**
 * Runs an async loader and tracks its state.
 *
 * Two details matter: a resolved request from an unmounted component never
 * touches state (so navigating away mid-load cannot warn or leak), and callers
 * can re-run the loader to refresh.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const mounted = useRef(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: null }));

    loader()
      .then((data) => {
        if (cancelled || !mounted.current) return;
        setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (cancelled || !mounted.current) return;
        setState({ data: null, error: toAppError(error), loading: false });
      });

    return () => {
      cancelled = true;
    };
    // `loader` is intentionally excluded: callers pass an inline closure and
    // control re-runs through `deps` (and `reload`), which avoids an infinite
    // loop when the loader identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, reload };
}
