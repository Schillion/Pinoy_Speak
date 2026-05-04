"use client";

import { useEffect, useState } from "react";
import { animate, useMotionValue, useTransform, motion } from "framer-motion";

interface Props {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}

export default function AnimatedNumber({
  value,
  duration = 1.1,
  format = (n) => Math.round(n).toLocaleString(),
  className,
}: Props) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => format(v));
  const [display, setDisplay] = useState(format(0));

  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1] });
    const unsub = rounded.on("change", (v) => setDisplay(v));
    return () => { controls.stop(); unsub(); };
  }, [value, duration, mv, rounded]);

  return <motion.span className={className}>{display}</motion.span>;
}
