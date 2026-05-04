export default function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? (
            <mark
              key={i}
              className="bg-gradient-to-r from-blue-500/30 to-purple-500/25 text-blue-100
                         rounded px-0.5 not-italic font-medium
                         shadow-[0_0_8px_-2px_rgba(96,165,250,0.6)]"
            >
              {part}
            </mark>
          )
          : part
      )}
    </>
  );
}
