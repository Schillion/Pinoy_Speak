"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ background: "#050915", color: "#e2e8f0", fontFamily: "Inter, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 1.5rem" }}>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 12 }}>App crashed</p>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Pinoy Speak hit a fatal error</h2>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", maxWidth: 460, marginBottom: 20 }}>
            {error.message || "Refresh the page to try again."}
          </p>
          <button
            onClick={reset}
            style={{ padding: "10px 20px", borderRadius: 12, background: "linear-gradient(to right, #2563eb, #4f46e5)", color: "#fff", border: 0, cursor: "pointer", fontWeight: 500 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
