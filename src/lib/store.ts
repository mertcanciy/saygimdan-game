"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface User {
  name: string;
  email: string;
}

interface UserState {
  user: User | null;
  setUser: (user: User) => void;
  clearUser: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      clearUser: () => set({ user: null }),
    }),
    { name: "saygimdan-user" }
  )
);

export function useHydrated(): boolean {
  return useSyncExternalStore(
    (cb) => useUserStore.persist.onFinishHydration(cb),
    () => useUserStore.persist.hasHydrated(),
    () => false
  );
}

interface MusicState {
  /** set once the visitor has pressed play somewhere (browsers need a gesture) */
  started: boolean;
  start: () => void;
}

/** Global song state: the dock lives in the root layout so the song keeps playing across pages. */
export const useMusicStore = create<MusicState>()((set) => ({
  started: false,
  start: () => set({ started: true }),
}));
