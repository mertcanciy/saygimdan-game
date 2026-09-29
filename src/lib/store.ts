"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Via = "password" | "google" | "mail";

/** The player on this device. `token` is the device's key to the leaderboard API. */
export interface User {
  id: string;
  name: string;
  via: Via;
  token: string;
}

interface UserState {
  user: User | null;
  /** last name typed on this device: prefills the sign-in dialog */
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
      version: 3,
      // v1 kept { name, email } on the device only, v2 had password-less names:
      // sign in again (name prefilled)
      migrate: (persisted, version) => {
        const old = persisted as { user?: { name?: string } | null; lastName?: string } | null;
        if (version < 3) return { user: null, lastName: old?.user?.name ?? old?.lastName ?? "" };
        return persisted as UserState;
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

/**
 * The sign-in dialog (site/LoginDialog.tsx, mounted once in the root layout).
 * `next`: where to go after signing in.
 */
interface LoginDialogState {
  open: boolean;
  next: string | null;
  show: (next?: string | null) => void;
  hide: () => void;
}

export const useLoginDialog = create<LoginDialogState>()((set) => ({
  open: false,
  next: null,
  show: (next = null) => set({ open: true, next }),
  hide: () => set({ open: false, next: null }),
}));

/** Global song state: see lib/musicEngine.ts (the player lives outside React). */
export { useMusicStore } from "./musicEngine";
