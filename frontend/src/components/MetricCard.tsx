"use client";

import { useTheme } from "@/context/ThemeContext";
import AnimatedNumber from "./AnimatedNumber";

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  onClick?: () => void;
  accent?: "blue" | "purple" | "cyan" | "pink";
}

const ACCENTS = {
  blue:   { text: "text-blue-300",   bar: "from-blue-500 to-cyan-400" },
  purple: { text: "text-purple-300", bar: "from-purple-500 to-pink-400" },
  cyan:   { text: "text-cyan-300",   bar: "from-cyan-400 to-blue-500" },
  pink:   { text: "text-pink-300",   bar: "from-pink-500 to-purple-500" },
};

function isNumeric(v: string | number): boolean {
  if (typeof v === "number") return true;
  const stripped = v.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(stripped);
}

export default function MetricCard({ label, value, sub, onClick, accent = "blue" }: Props) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const a = ACCENTS[accent];
  const numeric = isNumeric(value);
  const numVal = numeric
    ? typeof value === "number" ? value : Number(String(value).replace(/,/g, ""))
    : null;

  const interactive = !!onClick;
  return (
    <div
      onClick={onClick}
      style={isLight ? { backgroundColor: "#ffffff", backgroundImage: "none", backdropFilter: "none", WebkitBackdropFilter: "none" } : undefined}
      className={`card metric-card relative overflow-hidden rounded-2xl p-5
                  transition-colors duration-200 group
                  ${interactive ? "cursor-pointer hover:border-white/30" : ""}`}
    >
      {/* Top accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${a.bar} opacity-35`} />

      <p className="text-[11px] text-white/35 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-3xl font-bold ${numeric ? "text-white" : a.text} tracking-tight`}>
        {numeric && numVal !== null
          ? <AnimatedNumber value={numVal} />
          : value}
      </p>
      {sub && (
        <p className="text-xs text-white/35 mt-1.5">
          {onClick ? (
            <span className={`transition-colors ${isLight ? "group-hover:text-slate-600" : "group-hover:text-white/60"}`}>
              {sub} · <span className={`${a.text} opacity-70`}>view →</span>
            </span>
          ) : sub}
        </p>
      )}
    </div>
  );
}
