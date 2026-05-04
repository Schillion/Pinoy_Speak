"use client";

// Decorative-only background. Static layers (mesh gradient + grid + noise)
// are rendered in CSS — no JS animation loops, no event listeners. This is
// intentional for perf: the backdrop is always on every page and was the
// largest single contributor to mobile CPU usage.
export default function Backdrop() {
  return (
    <>
      <div className="backdrop-mesh" aria-hidden />
      <div className="backdrop-grid" aria-hidden />
      <div className="backdrop-noise" aria-hidden />
    </>
  );
}
