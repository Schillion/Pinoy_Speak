export default function PinoyLogo({ className = "w-full h-full" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Speech bubble — semi-transparent fill gives depth vs the gradient bg */}
      <path
        d="M3 2h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9L4 21V17H3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        fill="rgba(255,255,255,0.18)"
        stroke="rgba(255,255,255,0.82)"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />

      {/* P lettermark — bold, clean weight */}
      <path
        d="M7 5.5v8"
        stroke="white"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <path
        d="M7 5.5h3.5a2.5 2.5 0 0 1 0 5H7"
        stroke="white"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Philippine sun — center circle + 6 rays (upper-right of bubble) */}
      <circle cx="17.5" cy="4.8" r="1.55" fill="rgba(255,255,255,0.92)" />
      <path
        d="M17.5 2.4v-1
           M17.5 7.2v1
           M19.6 3.7l0.72-0.72
           M19.6 5.9l0.72 0.72
           M15.4 3.7l-0.72-0.72
           M15.4 5.9l-0.72 0.72"
        stroke="rgba(255,255,255,0.68)"
        strokeWidth="0.95"
        strokeLinecap="round"
      />
    </svg>
  );
}
