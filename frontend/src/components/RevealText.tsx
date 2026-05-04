"use client";

import { motion, Variants } from "framer-motion";

interface Props {
  /** Text to reveal. */
  text: string;
  /** HTML element tag to render. Default "span". */
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div";
  /** Split granularity. "word" (default) or "char". */
  split?: "word" | "char";
  /** Stagger between units in seconds. */
  stagger?: number;
  /** Initial delay before first unit. */
  delay?: number;
  /** Optional className passed to root. */
  className?: string;
  /** Optional className applied to each unit. Useful for gradient text. */
  unitClassName?: string;
}

const container = (stagger: number, delay: number): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

const item: Variants = {
  hidden: { opacity: 0, y: "60%", filter: "blur(10px)" },
  show: {
    opacity: 1,
    y: "0%",
    filter: "blur(0px)",
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  },
};

/**
 * Reveals text word-by-word or char-by-char on mount.
 * Each unit slides up + blurs in.
 */
export default function RevealText({
  text,
  as = "span",
  split = "word",
  stagger = 0.045,
  delay = 0,
  className = "",
  unitClassName = "",
}: Props) {
  const MotionTag = motion[as] as typeof motion.span;
  const units = split === "word" ? text.split(/(\s+)/) : Array.from(text);

  return (
    <MotionTag
      variants={container(stagger, delay)}
      initial="hidden"
      animate="show"
      className={`inline-block ${className}`}
      aria-label={text}
    >
      {units.map((u, i) => {
        if (/^\s+$/.test(u)) {
          return <span key={i} aria-hidden>{u}</span>;
        }
        return (
          <span
            key={i}
            aria-hidden
            className="inline-block overflow-hidden align-bottom"
            style={{ lineHeight: 1.1 }}
          >
            <motion.span variants={item} className={`inline-block ${unitClassName}`}>
              {u}
            </motion.span>
          </span>
        );
      })}
    </MotionTag>
  );
}
