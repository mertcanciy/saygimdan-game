"use client";

import Placeholder from "./Placeholder";

export default function Drift({ started }: { started: boolean }) {
  return <Placeholder started={started} title="Drift" color="#a855f7" />;
}
