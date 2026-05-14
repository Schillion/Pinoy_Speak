export default function MessageBubble({ content }: { content: string }) {
  return (
    <div className="space-y-1 leading-relaxed">
      {content.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        const parts = line.split(/\*\*(.+?)\*\*/g);
        return (
          <p key={i}>
            {parts.map((part, j) =>
              j % 2 === 1
                ? <strong key={j} className="text-blue-200 font-semibold">{part}</strong>
                : part
            )}
          </p>
        );
      })}
    </div>
  );
}
