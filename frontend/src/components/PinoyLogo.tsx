export default function PinoyLogo({ className = "w-full h-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Chat bubble body — white so it reads on any colored background */}
      <rect x="2" y="2" width="28" height="21" rx="6" fill="rgba(255,255,255,0.93)" />
      {/* Tail — bottom left, kept inside the rounded-container safe zone */}
      <path d="M6 23 L5 29 L14 23 Z" fill="rgba(255,255,255,0.93)" />
      {/* P lettermark in dark indigo */}
      <path d="M12 8 L12 19" stroke="#312e81" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M12 8 h3.5 a3.5 3.5 0 0 1 0 7 h-3.5"
        stroke="#312e81" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
