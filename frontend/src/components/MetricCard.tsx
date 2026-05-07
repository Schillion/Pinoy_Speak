"use client";

import { motion, useMotionValue, useMotionTemplate, useSpring } from "framer-motion";
import { useRef, useState } from "react";
import AnimatedNumber from "./AnimatedNumber";

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  onClick?: () => void;
  accent?: "blue" | "purple" | "cyan" | "pink";
}

const ACCENTS = {
  blue:   { glow: "rgba(96,165,250,0.45)",  text: "text-blue-300",   bar: "from-blue-500 to-cyan-400",    spotlight: "rgba(96,165,250,0.22)" },
  purple: { glow: "rgba(167,139,250,0.45)", text: "text-purple-300", bar: "from-purple-500 to-pink-400",  spotlight: "rgba(167,139,250,0.22)" },
  cyan:   { glow: "rgba(34,211,238,0.45)",  text: "text-cyan-300",   bar: "from-cyan-400 to-blue-500",    spotlight: "rgba(34,211,238,0.22)" },
  pink:   { glow: "rgba(244,114,182,0.45)", text: "text-pink-300",   bar: "from-pink-500 to-purple-500",  spotlight: "rgba(244,114,182,0.22)" },
};

function isNumeric(v: string | number): boolean {
  if (typeof v === "number") return true;
  const stripped = v.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(stripped);
}

export default function MetricCard({ label, value, sub, onClick, accent = "blue" }: Props) {
  const a = ACCENTS[accent];
  const numeric = isNumeric(value);
  const numVal = numeric
    ? typeof value === "number" ? value : Number(String(value).replace(/,/g, ""))
    : null;

  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  const mxRaw = useMotionValue(50);
  const myRaw = useMotionValue(50);
  const rxRaw = useMotionValue(0);
  const ryRaw = useMotionValue(0);
  const rx = useSpring(rxRaw, { stiffness: 220, damping: 22, mass: 0.4 });
  const ry = useSpring(ryRaw, { stiffness: 220, damping: 22, mass: 0.4 });

  const rotateX = useMotionTemplate`${rx}deg`;
  const rotateY = useMotionTemplate`${ry}deg`;
  const spotlight = useMotionTemplate`radial-gradient(360px circle at ${mxRaw}% ${myRaw}%, ${a.spotlight}, transparent 45%)`;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    mxRaw.set(nx * 100);
    myRaw.set(ny * 100);
    rxRaw.set((0.5 - ny) * 6);
    ryRaw.set((nx - 0.5) * 6);
  };
  const onLeave = () => {
    rxRaw.set(0);
    ryRaw.set(0);
    setHovered(false);
  };

  const interactive = !!onClick;
  return (
    <motion.div
      ref={ref}
      onMouseMove={interactive ? onMove : undefined}
      onMouseEnter={interactive ? () => setHovered(true) : undefined}
      onMouseLeave={interactive ? onLeave : undefined}
      onClick={onClick}
      style={interactive
        ? { rotateX, rotateY, transformStyle: "preserve-3d", transformPerspective: 1000 }
        : undefined}
      className={`card relative overflow-hidden rounded-2xl p-5
                  transition-colors duration-300 group
                  ${interactive ? "cursor-pointer hover:border-white/25" : ""}`}
    >
      {/* Cursor spotlight + ambient glow only fire on clickable cards, so the
          hover affordance matches the actual behavior. */}
      {interactive && (
        <>
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
            style={{ background: spotlight, opacity: hovered ? 1 : 0 }}
          />
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
            style={{
              background: `radial-gradient(circle at 50% 0%, ${a.glow}, transparent 70%)`,
              filter: "blur(20px)",
            }}
          />
        </>
      )}

      {/* Top gradient bar */}
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${a.bar} opacity-40 group-hover:opacity-90 transition-opacity`} />

      <div className="relative" style={{ transform: "translateZ(1px)" }}>
        <p className="text-[11px] text-white/35 uppercase tracking-wider mb-2">{label}</p>
        <p className={`text-3xl font-bold ${numeric ? "text-white" : a.text} tracking-tight`}>
          {numeric && numVal !== null
            ? <AnimatedNumber value={numVal} />
            : value}
        </p>
        {sub && (
          <p className="text-xs text-white/35 mt-1.5">
            {onClick ? (
              <span className="group-hover:text-white/60 transition-colors">
                {sub} · <span className={`${a.text} opacity-70`}>view →</span>
              </span>
            ) : sub}
          </p>
        )}
      </div>
    </motion.div>
  );
}
