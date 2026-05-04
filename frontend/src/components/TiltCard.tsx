"use client";

import { motion, useMotionValue, useSpring, useMotionTemplate } from "framer-motion";
import { useRef, useState, useEffect } from "react";

interface Props {
  children: React.ReactNode;
  className?: string;
  /** Max tilt angle in degrees. Default 6. */
  intensity?: number;
  /** Radius of the cursor spotlight in px. Default 380. */
  spotlightSize?: number;
  /** Spotlight color (rgba). */
  spotlightColor?: string;
  onClick?: () => void;
}

/**
 * Glass card that tilts toward the cursor with a radial spotlight highlight.
 *
 * Tilt + spotlight are disabled on touch devices (no hover, no precise
 * pointer) — they cost spring physics on every move and feel jittery on
 * phones. Touch devices fall back to a plain static card.
 */
export default function TiltCard({
  children,
  className = "",
  intensity = 6,
  spotlightSize = 380,
  spotlightColor = "rgba(120,170,255,0.18)",
  onClick,
}: Props) {
  // Touch detection — set once on mount. We can't detect at render time
  // (SSR has no window) so the first paint always renders the desktop
  // version, then drops the spring on hydration if we're on touch.
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    setIsTouch(mq.matches);
    const onChange = () => setIsTouch(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  const rxRaw = useMotionValue(0);
  const ryRaw = useMotionValue(0);
  const mx = useMotionValue(50);
  const my = useMotionValue(50);

  const rx = useSpring(rxRaw, { stiffness: 220, damping: 22, mass: 0.4 });
  const ry = useSpring(ryRaw, { stiffness: 220, damping: 22, mass: 0.4 });

  const rotateX = useMotionTemplate`${rx}deg`;
  const rotateY = useMotionTemplate`${ry}deg`;
  const spotlightBg = useMotionTemplate`radial-gradient(${spotlightSize}px circle at ${mx}% ${my}%, ${spotlightColor}, transparent 40%)`;

  // Static fallback for touch devices — no springs, no event listeners
  if (isTouch) {
    return (
      <div
        ref={ref}
        onClick={onClick}
        className={`relative ${className} ${onClick ? "cursor-pointer" : ""}`}
      >
        <div className="relative h-full">{children}</div>
      </div>
    );
  }

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    rxRaw.set((0.5 - ny) * intensity * 2);
    ryRaw.set((nx - 0.5) * intensity * 2);
    mx.set(nx * 100);
    my.set(ny * 100);
  };

  const handleLeave = () => {
    rxRaw.set(0);
    ryRaw.set(0);
    setHovered(false);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={handleLeave}
      onClick={onClick}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
        transformPerspective: 1000,
      }}
      className={`relative ${className} ${onClick ? "cursor-pointer" : ""}`}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
        style={{
          background: spotlightBg,
          opacity: hovered ? 1 : 0,
        }}
      />
      <div style={{ transform: "translateZ(1px)" }} className="relative h-full">
        {children}
      </div>
    </motion.div>
  );
}
