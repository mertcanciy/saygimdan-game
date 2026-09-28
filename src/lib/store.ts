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

/** Global song state: see lib/musicEngine.ts (the player lives outside React). */
export { useMusicStore } from "./musicEngine";
