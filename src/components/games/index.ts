"use client";

import dynamic from "next/dynamic";
import { GameSlug } from "@/lib/games";

export const GAME_COMPONENTS: Record<
  GameSlug,
  React.ComponentType<{ started: boolean }>
> = {
  spiderman: dynamic(() => import("./Spiderman"), {
    ssr: false,
    loading: () => null,
  }),
  drift: dynamic(() => import("./Drift"), {
    ssr: false,
    loading: () => null,
  }),
  f16: dynamic(() => import("./F16"), {
    ssr: false,
    loading: () => null,
  }),
  traffic: dynamic(() => import("./Traffic"), {
    ssr: false,
    loading: () => null,
  }),
};
