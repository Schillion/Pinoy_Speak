export default function PinoyLogo({ className = "w-full h-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <linearGradient id="ps-bubble-g" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      {/* Chat bubble body */}
      <rect x="2" y="2" width="28" height="21" rx="6" fill="url(#ps-bubble-g)" />
      {/* Tail — bottom left */}
      <path d="M5 23 L3 30 L13 23 Z" fill="url(#ps-bubble-g)" />
      {/* P lettermark */}
      <path d="M12 8 L12 19" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M12 8 h3.5 a3.5 3.5 0 0 1 0 7 h-3.5"
        stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
