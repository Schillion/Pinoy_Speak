"use client";

import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Backdrop from "@/components/Backdrop";
import PageTransition from "@/components/PageTransition";
import { ProfanityProvider } from "@/context/ProfanityContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

function SidebarWithFilter() {
  return <Sidebar />;
}

function ModelStatusBanner() {
  const [modelLoaded, setModelLoaded] = useState<boolean | null>(null);
  const [checking, setChecking]       = useState(false);
  const [dismissed, setDismissed]     = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const r = await fetch("/api/corpus-stats", { cache: "no-store" });
      const ok = r.ok;
      setModelLoaded(ok);
      if (ok) setDismissed(false);   // re-show banner if backend goes down again
    } catch {
      setModelLoaded(false);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, []);

  if (modelLoaded !== false || dismissed) return null;

  return (
    <div className="md:ml-[88px] px-4 md:px-8 pt-16 md:pt-4 relative z-10">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-xl backdrop-blur-xl
                   border border-amber-400/25 border-l-2 border-l-amber-300
                   px-4 py-3 text-amber-100/80 text-xs flex items-center gap-3
                   bg-gradient-to-r from-amber-500/[.08] to-orange-500/[.04]
                   shadow-[0_0_24px_-8px_rgba(251,191,36,0.4)]"
      >
        <span className="w-3.5 h-3.5 border-2 border-amber-400/30 border-t-amber-300
                         rounded-full animate-spin flex-shrink-0" />
        <span className="flex-1">
          Backend offline — start the API with <code className="bg-white/[.08] px-1.5 py-0.5 rounded text-amber-100">uvicorn api.main:app --port 8000</code>.
        </span>
        <button
          onClick={check}
          disabled={checking}
          className="flex-shrink-0 text-[11px] px-2 py-1 rounded-md
                     border border-amber-400/30 text-amber-100
                     hover:bg-amber-500/15 transition-colors disabled:opacity-50"
        >
          {checking ? "Checking…" : "Retry"}
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          title="Dismiss (re-appears if backend goes down again later)"
          className="flex-shrink-0 w-6 h-6 rounded-md
                     text-amber-100/70 hover:text-amber-100 hover:bg-amber-500/15
                     transition-colors flex items-center justify-center text-base leading-none"
        >
          ×
        </button>
      </motion.div>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>Pinoy Speak</title>
        <meta name="description" content="Filipino Slang Tracker" />
      </head>
      <body>
        <ThemeProvider>
          <ProfanityProvider>
            <Backdrop />
            <SidebarWithFilter />
            <ModelStatusBanner />
            <main
              style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}
              className="min-h-screen p-4 pt-16 md:!pb-8 md:pt-8 md:p-8 md:ml-[88px]"
            >
              <PageTransition>{children}</PageTransition>
            </main>
          </ProfanityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
