export default function PinoyLogo({ className = "w-full h-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <path
          key={angle}
          d="M16 1 L14.2 7.7 L17.8 7.7 Z"
          transform={`rotate(${angle} 16 16)`}
          fill="rgba(255,255,255,0.92)"
        />
      ))}
      <circle cx="16" cy="16" r="6.5" fill="white" />
      <path d="M12.5 11 L12.5 21" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M12.5 11 h4 a3 3 0 0 1 0 6 h-4" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
