"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Touch-control preferences, remembered on the device.
 * driftAutoGas: in Drift the car accelerates on its own (brake / handbrake
 * still work), so a phone needs only the wheel and the handbrake — gas,
 * handbrake and steering at once is too much for two thumbs.
 */
interface TouchPrefs {
  driftAutoGas: boolean;
  setDriftAutoGas: (on: boolean) => void;
}

export const useTouchPrefs = create<TouchPrefs>()(
  persist(
    (set) => ({
      driftAutoGas: true,
      setDriftAutoGas: (driftAutoGas) => set({ driftAutoGas }),
    }),
    { name: "saygimdan-touch-prefs" }
  )
);
