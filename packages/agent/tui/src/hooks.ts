import { useSyncExternalStore } from 'react';
import type { TuiStore } from './store.js';

export function useTuiStore<T>(store: TuiStore, selector: (state: ReturnType<TuiStore['getState']>) => T): T {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
