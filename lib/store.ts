'use client';
import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get: () => T;
  set: (patch: Partial<T>) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
      subs.forEach((f) => f());
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

// bump to make data-driven views refetch (detections, frames, routes)
export const dataVersion = createStore({ n: 0 });
export const bumpData = () => dataVersion.set({ n: dataVersion.get().n + 1 });

// toast bus
export const toastStore = createStore<{ msg: string; info: boolean; at: number }>({ msg: '', info: false, at: 0 });
export const toast = (msg: string, info = false) => toastStore.set({ msg, info, at: Date.now() });
