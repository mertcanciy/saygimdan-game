"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface User {
  name: string;
  /** leaderboard session; null = guest (plays, but scores stay on this device) */
  token: string | null;
}

interface UserState {
  user: User | null;
  /** last name typed in, to prefill the sign-in dialog */
  lastName: string;
  setUser: (user: User) => void;
  clearUser: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      user: null,
      lastName: "",
      setUser: (user) => set({ user, lastName: user.name }),
      clearUser: () => set({ user: null }),
    }),
    {
      name: "saygimdan-user",
      version: 1,
      // v0 kept { name, email } locally: sign in again (username + PIN), name prefilled
      migrate: (old, version) => {
        if (version === 0) {
          const name = (old as { user?: { name?: string } | null } | null)?.user?.name ?? "";
          return { user: null, lastName: name } as unknown as UserState;
        }
        return old as UserState;
      },
    }
  )
);

export function useHydrated(): boolean {
  return useSyncExternalStore(
    (cb) => useUserStore.persist.onFinishHydration(cb),
    () => useUserStore.persist.hasHydrated(),
    () => false
  );
}

interface AuthDialogState {
  open: boolean;
  /** where to go after signing in */
  next: string | null;
  /** closing without signing in leaves the page (it can't be used signed out) */
  required: boolean;
  show: (opts?: { next?: string; required?: boolean }) => void;
  close: () => void;
}

export const useAuthDialog = create<AuthDialogState>()((set) => ({
  open: false,
  next: null,
  required: false,
  show: (opts) => set({ open: true, next: opts?.next ?? null, required: !!opts?.required }),
  close: () => set({ open: false, next: null, required: false }),
}));

/** Global song state: see lib/musicEngine.ts (the player lives outside React). */
export { useMusicStore } from "./musicEngine";
