import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          blue:   "#60a5fa",
          purple: "#a78bfa",
          cyan:   "#76e4f7",
          pink:   "#f472b6",
        },
        surface: {
          DEFAULT: "rgba(255,255,255,0.025)",
          border:  "rgba(255,255,255,0.07)",
        },
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
      backgroundImage: {
        "grad-blue-purple": "linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%)",
        "grad-mesh":
          "radial-gradient(at 20% 20%, rgba(96,165,250,0.20), transparent 50%), radial-gradient(at 80% 10%, rgba(167,139,250,0.18), transparent 45%), radial-gradient(at 70% 80%, rgba(34,211,238,0.10), transparent 45%)",
      },
      boxShadow: {
        glow: "0 0 24px -4px rgba(96,165,250,0.5)",
        "glow-strong": "0 0 40px -8px rgba(96,165,250,0.7)",
      },
      keyframes: {
        fadeUp: {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          "0%":   { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        wiggle: {
          "0%, 100%": { transform: "rotate(0deg)" },
          "25%": { transform: "rotate(-3deg)" },
          "75%": { transform: "rotate(3deg)" },
        },
      },
      animation: {
        "fade-up": "fadeUp 0.5s ease-out forwards",
        "scale-in": "scaleIn 0.35s ease-out forwards",
        wiggle: "wiggle 0.4s ease-in-out",
      },
    },
  },
  plugins: [],
};

export default config;
