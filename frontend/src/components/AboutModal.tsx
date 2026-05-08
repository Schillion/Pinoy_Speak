"use client";

import { motion } from "framer-motion";
import { useEffect } from "react";
import PinoyLogo from "./PinoyLogo";

interface Props {
  onClose: () => void;
}

export default function AboutModal({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="relative card spotlight p-7 max-w-md w-[92%] mx-4
                   shadow-[0_30px_80px_-20px_rgba(99,102,241,0.6)]"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-full
                     text-white/40 hover:text-white hover:bg-white/[.06]
                     transition-colors flex items-center justify-center text-lg"
        >
          ×
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="aurora-border w-12 h-12 rounded-2xl overflow-hidden
                          bg-gradient-to-br from-blue-500 to-purple-600
                          shadow-[0_0_28px_-4px_rgba(99,102,241,0.8)] select-none">
            <PinoyLogo />
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-widest">About the creator</p>
            <h2 className="text-shimmer text-xl font-bold leading-tight">Pinoy Speak</h2>
          </div>
        </div>

        <p className="text-sm text-white/65 leading-relaxed mb-5">
          Pinoy Speak is a Filipino slang tracker that scrapes social media,
          checks dictionaries, and detects new words and meaning shifts in real time.
        </p>

        <div className="space-y-3 text-sm">
          <Row label="Built by"   value="Carl Timothy E. Clemente" />
          <Row label="From"       value="Montalban, Rizal" />
          <Row label="University" value="University of the Philippines Los Baños (UPLB)" />
          <Row label="Status"     value="Senior Student" />
        </div>

        <div className="mt-6 pt-4 border-t border-white/[.06] text-[11px] text-white/35 italic">
          Salamat sa pagsuporta — keep speaking Pinoy! 🤙
        </div>
      </motion.div>
    </motion.div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] text-white/35 uppercase tracking-widest w-24 flex-shrink-0">
        {label}
      </span>
      <span className="text-white/85 font-medium">{value}</span>
    </div>
  );
}
