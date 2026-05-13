"use client";

import { createContext, useContext, useState, useEffect } from "react";

type Theme    = "dark" | "light";
type FontSize = "small" | "medium" | "large" | "xlarge" | "xxlarge" | "xxxlarge";

export type { FontSize };

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  fontSize: FontSize;
  setFontSize: (s: FontSize) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  setTheme: () => {},
  toggleTheme: () => {},
  fontSize: "large",
  setFontSize: () => {},
});

const THEME_KEY = "pinoyspeak_theme";
const FONT_KEY  = "pinoyspeak_font_size";

const FONT_PX: Record<FontSize, number> = {
  small:    15,
  medium:   17.5,
  large:    21,
  xlarge:   24,
  xxlarge:  27,
  xxxlarge: 30,
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState]       = useState<Theme>("dark");
  const [fontSize, setFontSizeState] = useState<FontSize>("large");

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_KEY);
    const initialTheme: Theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
    setThemeState(initialTheme);
    document.documentElement.setAttribute("data-theme", initialTheme);

    const storedFont = localStorage.getItem(FONT_KEY) as FontSize | null;
    const initialFont: FontSize = storedFont && FONT_PX[storedFont] ? storedFont : "large";
    setFontSizeState(initialFont);
    document.documentElement.style.fontSize = `${FONT_PX[initialFont]}px`;
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
    document.documentElement.setAttribute("data-theme", t);
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  function setFontSize(s: FontSize) {
    setFontSizeState(s);
    localStorage.setItem(FONT_KEY, s);
    document.documentElement.style.fontSize = `${FONT_PX[s]}px`;
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, fontSize, setFontSize }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
