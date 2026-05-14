"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const POLL_INTERVAL = 60_000; // 1 minute

export default function UpdateNotice() {
  const initialId = useRef<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { buildId } = await r.json();

        if (buildId === "dev") return; // skip in local dev

        if (initialId.current === null) {
          initialId.current = buildId;
          return;
        }

        if (!cancelled && buildId !== initialId.current) {
          setUpdateReady(true);
        }
      } catch {
        // network error — ignore silently
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function reload() {
    setReloading(true);
    window.location.reload();
  }

  return (
    <AnimatePresence>
      {updateReady && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
          style={{ backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", background: "rgba(5,7,20,0.75)" }}
        >
          <motion.div
            initial={{ scale: 0.88, opacity: 0, y: 24 }}
            animate={{ scale: 1,    opacity: 1, y: 0  }}
            transition={{ type: "spring", stiffness: 280, damping: 22, delay: 0.05 }}
            className="relative w-full max-w-sm rounded-2xl overflow-hidden
                       border border-white/[.09]
                       bg-gradient-to-br from-[#0d1127]/90 to-[#070913]/90
                       shadow-[0_32px_80px_-20px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.04)]
                       p-8 text-center"
          >
            {/* Animated gradient orb */}
            <div
              aria-hidden
              className="absolute -top-16 left-1/2 -translate-x-1/2 w-56 h-56
                         rounded-full blur-3xl opacity-30 pointer-events-none
                         bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600"
            />

            {/* Icon */}
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1,   opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.15 }}
              className="relative w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center
                         bg-gradient-to-br from-blue-500/20 to-purple-500/15
                         border border-blue-400/25
                         shadow-[0_0_32px_-8px_rgba(96,165,250,0.6)]"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                   style={{ color: "#93c5fd" }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="text-xl font-bold mb-2 tracking-tight"
              style={{ color: "#ffffff" }}
            >
              Update Ready
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.4 }}
              className="text-sm leading-relaxed mb-7"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              PinoySpeak just got an update.
              <br />
              Reload to get the latest version.
            </motion.p>

            <motion.button
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              onClick={reload}
              disabled={reloading}
              className="w-full btn-primary py-3 text-sm font-semibold
                         disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {reloading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Reloading…
                </>
              ) : "Reload Now"}
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
