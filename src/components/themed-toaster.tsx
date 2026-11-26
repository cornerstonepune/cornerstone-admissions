"use client";

import { Toaster } from "sonner";

// Held light (ADR 0019 §2, ADR 0020).
export function ThemedToaster() {
  return (
    <Toaster
      theme="light"
      position="top-right"
      toastOptions={{
        style: {
          background: "var(--popover)",
          border: "1px solid var(--border)",
          color: "var(--popover-foreground)",
        },
      }}
    />
  );
}
