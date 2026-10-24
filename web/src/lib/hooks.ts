import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Me, Meta } from './types';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const load = useCallback(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef
      .current()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e: Error) => alive && setState({ data: null, error: e.message, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(load, [load]);
  return { ...state, reload: load, setData: (data: T) => setState({ data, error: null, loading: false }) };
}

let metaPromise: Promise<Meta> | null = null;
export function useMeta() {
  return useAsync(() => (metaPromise ||= api.meta().catch((e) => ((metaPromise = null), Promise.reject(e)))), []);
}

// The signed-in user, loaded once by the access gate and shared app-wide.
const ME_EVENT = 'isim:me';
let mePromise: Promise<Me> | null = null;
let meCache: Me | null = null;
export const loadMe = (fresh = false) => {
  if (fresh || !mePromise) {
    mePromise = api.me().then(
      (me) => {
        meCache = me;
        window.dispatchEvent(new Event(ME_EVENT));
        return me;
      },
      (e) => ((mePromise = null), Promise.reject(e)),
    );
  }
  return mePromise;
};
export function useMe() {
  const [me, setMe] = useState<Me | null>(meCache);
  useEffect(() => {
    const sync = () => setMe(meCache);
    window.addEventListener(ME_EVENT, sync);
    loadMe().then(sync, () => {});
    return () => window.removeEventListener(ME_EVENT, sync);
  }, []);
  return { data: me };
}
/** Refetch after something changed today's usage (an interview started or finished). */
export const refreshMe = () => loadMe(true).catch(() => {});

/** Calls `fn` on a keyboard shortcut unless the user is typing in a field. */
export function useHotkey(key: string, fn: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === key || e.code === key) {
        e.preventDefault();
        ref.current(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, enabled]);
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
