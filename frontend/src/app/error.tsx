"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
      <p className="text-[11px] text-white/35 uppercase tracking-widest mb-3">Something broke</p>
      <h2 className="text-2xl font-bold text-shimmer mb-2">Unexpected error</h2>
      <p className="text-sm text-white/55 max-w-md mb-5">
        {error.message || "Pinoy Speak hit an issue rendering this page."}
      </p>
      <button
        onClick={reset}
        className="btn-primary w-auto px-5 py-2 text-sm"
      >
        Try again
      </button>
    </div>
  );
}
