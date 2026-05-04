"use client";

import { createContext, useContext, useState, useEffect } from "react";

interface ProfanityContextType {
  profanityFilter: boolean;
  setProfanityFilter: (v: boolean) => void;
}

const ProfanityContext = createContext<ProfanityContextType>({
  profanityFilter: true,
  setProfanityFilter: () => {},
});

const STORAGE_KEY = "pinoyspeak_profanity_filter";

export function ProfanityProvider({ children }: { children: React.ReactNode }) {
  const [profanityFilter, setProfanityFilterState] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setProfanityFilterState(stored === "true");
  }, []);

  function setProfanityFilter(v: boolean) {
    setProfanityFilterState(v);
    localStorage.setItem(STORAGE_KEY, String(v));
  }

  return (
    <ProfanityContext.Provider value={{ profanityFilter, setProfanityFilter }}>
      {children}
    </ProfanityContext.Provider>
  );
}

export function useProfanityFilter() {
  return useContext(ProfanityContext);
}
