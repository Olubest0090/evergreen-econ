"use client";

import { useEffect } from "react";

/** Quietly asks the server to check for new in-game deposits. The server decides if a real check is due. */
export default function DepositSync() {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === "visible") fetch("/api/sync/deposits", { cache: "no-store" }).catch(() => {});
    };
    ping();
    const t = setInterval(ping, 3 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  return null;
}
