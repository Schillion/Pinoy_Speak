import type { Variants, Transition } from "framer-motion";

export const spring: Transition = { type: "spring", stiffness: 260, damping: 24 };
export const springSoft: Transition = { type: "spring", stiffness: 180, damping: 22 };
export const easeOut: Transition = { duration: 0.4, ease: [0.22, 1, 0.36, 1] };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show:   { opacity: 1, y: 0, transition: easeOut },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { duration: 0.35 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show:   { opacity: 1, scale: 1, transition: spring },
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.8, y: 6 },
  show:   { opacity: 1, scale: 1, y: 0, transition: spring },
};

export const slideFromLeft: Variants = {
  hidden: { opacity: 0, x: -12 },
  show:   { opacity: 1, x: 0, transition: easeOut },
};

export const slideFromRight: Variants = {
  hidden: { opacity: 0, x: 12 },
  show:   { opacity: 1, x: 0, transition: easeOut },
};

export const staggerContainer = (stagger = 0.06, delay = 0): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: stagger, delayChildren: delay },
  },
});

export const modalBackdrop: Variants = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { duration: 0.2 } },
  exit:   { opacity: 0, transition: { duration: 0.15 } },
};

export const modalContent: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 8 },
  show:   { opacity: 1, scale: 1, y: 0, transition: spring },
  exit:   { opacity: 0, scale: 0.95, y: 4, transition: { duration: 0.15 } },
};

export const blurIn: Variants = {
  hidden: { opacity: 0, filter: "blur(12px)", y: 12 },
  show:   { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

export const fadeUpSoft: Variants = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show:   { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

export const revealChar: Variants = {
  hidden: { opacity: 0, y: "0.5em", filter: "blur(8px)" },
  show: {
    opacity: 1,
    y: "0em",
    filter: "blur(0px)",
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  },
};

export const revealWord: Variants = {
  hidden: { opacity: 0, y: "40%", filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: "0%",
    filter: "blur(0px)",
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
};

export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 12, filter: "blur(6px)" },
  show:   { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
  exit:   { opacity: 0, y: -6, filter: "blur(4px)", transition: { duration: 0.2 } },
};
