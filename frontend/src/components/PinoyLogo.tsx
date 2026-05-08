export default function PinoyLogo({ className = "w-full h-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Chat bubble body */}
      <rect x="3" y="4" width="26" height="18" rx="5" fill="rgba(255,255,255,0.93)" />
      {/* Tail — bottom left */}
      <path d="M6 22 L5 28 L13 22 Z" fill="rgba(255,255,255,0.93)" />
      {/* P lettermark in dark indigo */}
      <path d="M13 8 L13 18" stroke="#312e81" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M13 8 h3.5 a3.5 3.5 0 0 1 0 7 h-3.5"
        stroke="#312e81" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
