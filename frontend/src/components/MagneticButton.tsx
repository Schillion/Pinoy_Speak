"use client";

import { motion, useMotionValue, useSpring } from "framer-motion";
import { useRef } from "react";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  /** Pull strength — higher = more magnetic pull. Default 0.35 */
  strength?: number;
}

/**
 * Button that drifts toward the cursor when hovered.
 * Wraps a native <button> — all button props pass through.
 */
export default function MagneticButton({
  children,
  strength = 0.35,
  className = "",
  ...rest
}: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const xRaw = useMotionValue(0);
  const yRaw = useMotionValue(0);
  const x = useSpring(xRaw, { stiffness: 260, damping: 18, mass: 0.35 });
  const y = useSpring(yRaw, { stiffness: 260, damping: 18, mass: 0.35 });

  const handleMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    xRaw.set((e.clientX - cx) * strength);
    yRaw.set((e.clientY - cy) * strength);
  };

  const handleLeave = () => {
    xRaw.set(0);
    yRaw.set(0);
  };

  return (
    <motion.button
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{ x, y }}
      whileTap={{ scale: 0.96 }}
      className={className}
      {...(rest as React.ComponentProps<typeof motion.button>)}
    >
      {children}
    </motion.button>
  );
}
