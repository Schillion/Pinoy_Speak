"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import AboutModal from "./AboutModal";
import { useTheme } from "@/context/ThemeContext";

const NAV: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: "/",           label: "Home",       icon: <HomeIcon />     },
  { href: "/top-slang",  label: "Top Slang",  icon: <StarIcon />     },
  { href: "/dictionary", label: "Dictionary", icon: <BookIcon />     },
  { href: "/translator", label: "Translator", icon: <TranslateIcon />},
  { href: "/chat",       label: "Tutor",      icon: <SparkIcon />    },
];

export default function Sidebar() {
  const path = usePathname();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { theme, toggleTheme, fontSize, setFontSize } = useTheme();

  return (
    <>
      <AnimatePresence>
        {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      </AnimatePresence>

      {/* Mobile-only floating logo — must live OUTSIDE the <aside> because
          the aside's backdrop-filter creates a containing block, which traps
          a nested position:fixed and pins it to the bottom bar instead of
          the viewport. */}
      <Link
        href="/about"
        className="md:hidden fixed top-3 left-3 z-30
                   w-10 h-10 rounded-xl flex items-center justify-center
                   bg-gradient-to-br from-blue-500 to-purple-600
                   shadow-[0_0_24px_-4px_rgba(99,102,241,0.75)]
                   text-white font-bold text-base select-none aurora-border"
        aria-label="About PinoySpeak"
      >
        P
      </Link>

      <aside
        data-sidebar
        className="
          fixed z-20
          bg-gradient-to-b from-[#060b17]/95 via-[#070d1a]/95 to-[#050912]/95
          backdrop-blur-2xl

          /* Mobile: horizontal bottom bar — height extends through iOS home
             indicator safe area, content is padded so buttons stay tappable */
          bottom-0 left-0 right-0 flex-row items-stretch
          h-[calc(68px+env(safe-area-inset-bottom))]
          pb-[env(safe-area-inset-bottom)]
          border-t border-white/[.06]

          /* Desktop: vertical left column */
          md:top-0 md:bottom-0 md:right-auto md:w-[88px] md:h-auto md:pb-0 md:flex-col md:items-stretch
          md:border-t-0 md:border-r
          md:shadow-[1px_0_40px_-20px_rgba(96,165,250,0.25)]

          flex
        "
      >
        {/* Logo — desktop only (mobile uses About link inside Settings).
            Sized to match the nav buttons below: same padding, same gap,
            same icon footprint, single-line label. */}
        <Link
          href="/about"
          className="hidden md:flex flex-col items-center justify-center gap-1
                     mx-2 mt-3 mb-2 py-3 rounded-xl
                     hover:bg-white/[.04] transition-colors group"
          aria-label="About PinoySpeak"
        >
          <motion.div
            whileHover={{ rotate: [0, -8, 8, 0], scale: 1.10 }}
            transition={{ duration: 0.5 }}
            className="aurora-border w-7 h-7 rounded-lg flex items-center justify-center
                       bg-gradient-to-br from-blue-500 to-purple-600
                       shadow-[0_0_18px_-4px_rgba(99,102,241,0.75)]
                       text-white font-bold text-xs select-none"
          >
            P
          </motion.div>
          <span className="text-[11px] font-semibold text-shimmer tracking-tight leading-tight">
            Pinoy Speak
          </span>
        </Link>

        {/* Nav — horizontal on mobile, vertical on desktop */}
        <nav className="
          flex-1
          flex flex-row md:flex-col
          items-stretch md:items-stretch
          justify-around md:justify-start
          gap-0 md:gap-1
          px-1 md:px-2
          pt-0 md:pt-3
        ">
          {NAV.map(({ href, label, icon }, i) => {
            const active = path === href;
            return (
              <motion.div
                key={href}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 md:flex-none flex"
              >
                <Link
                  href={href}
                  className={`group relative flex flex-col items-center justify-center gap-1
                              w-full py-2 md:py-3 rounded-xl transition-colors duration-200
                    ${active
                      ? "text-blue-200"
                      : "text-white/55 hover:text-white/95 hover:bg-white/[.04]"}`}
                  title={label}
                >
                  {active && (
                    <motion.span
                      layoutId="sidebar-active-pill"
                      className="absolute inset-0 rounded-xl
                                 bg-gradient-to-b from-blue-500/25 via-indigo-500/18 to-purple-500/12
                                 border border-blue-400/35
                                 shadow-[0_0_22px_-6px_rgba(96,165,250,0.7)]"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <motion.span
                    whileHover={!active ? { y: -2, scale: 1.05 } : undefined}
                    transition={{ duration: 0.3 }}
                    className={`relative w-6 h-6 flex items-center justify-center transition-transform
                                ${active ? "text-blue-300" : "text-current"}`}
                  >
                    {icon}
                  </motion.span>
                  <span className={`relative text-[10px] md:text-[11px] leading-tight tracking-tight
                                    ${active ? "font-semibold" : "font-medium"}`}>
                    {label}
                  </span>
                </Link>
              </motion.div>
            );
          })}

          {/* Settings — appears as the 5th item on mobile, stays in its own
              footer-row on desktop. We render it inside <nav> on mobile so
              the flex spacing distributes evenly across all 5 buttons. */}
          <div className="md:hidden flex-1 flex relative">
            <SettingsButton
              open={settingsOpen}
              onClick={() => setSettingsOpen((o) => !o)}
            />
            <SettingsPopover
              open={settingsOpen}
              theme={theme}
              toggleTheme={toggleTheme}
              fontSize={fontSize}
              setFontSize={setFontSize}
              onAbout={() => { setSettingsOpen(false); setAboutOpen(true); }}
              placement="up"
            />
          </div>
        </nav>

        {/* Settings — desktop only (mobile renders it inline in nav) */}
        <div className="hidden md:block border-t border-white/[.05] px-2 py-3 relative">
          <SettingsButton
            open={settingsOpen}
            onClick={() => setSettingsOpen((o) => !o)}
          />
          <SettingsPopover
            open={settingsOpen}
            theme={theme}
            toggleTheme={toggleTheme}
            fontSize={fontSize}
            setFontSize={setFontSize}
            onAbout={() => { setSettingsOpen(false); setAboutOpen(true); }}
            placement="right"
          />
        </div>
      </aside>
    </>
  );
}

/* ─── Settings button + popover ─────────────────────────────────────────── */

function SettingsButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex flex-col items-center justify-center gap-1 py-2 md:py-3 rounded-xl
                  transition-colors ${open
                    ? "text-blue-200 bg-white/[.05]"
                    : "text-white/55 hover:text-white/95 hover:bg-white/[.04]"}`}
      aria-label="Open settings"
      aria-expanded={open}
    >
      <span className="w-6 h-6 flex items-center justify-center"><GearIcon /></span>
      <span className="text-[10px] md:text-[11px] font-medium leading-tight">Settings</span>
    </button>
  );
}

import type { FontSize } from "@/context/ThemeContext";

interface SettingsPopoverProps {
  open: boolean;
  theme: "dark" | "light";
  toggleTheme: () => void;
  fontSize: FontSize;
  setFontSize: (s: FontSize) => void;
  onAbout: () => void;
  placement: "right" | "up";
}

function SettingsPopover({
  open, theme, toggleTheme, fontSize, setFontSize,
  onAbout, placement,
}: SettingsPopoverProps) {
  const positionCls = placement === "right"
    ? "absolute bottom-3 left-[100%] ml-2"
    : "absolute bottom-full mb-2 right-2";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: placement === "up" ? 6 : 0, x: placement === "right" ? -6 : 0, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
          exit={{ opacity: 0, y: placement === "up" ? 6 : 0, x: placement === "right" ? -6 : 0, scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          style={{ maxHeight: "min(70vh, 480px)" }}
          className={`${positionCls} z-30 w-60 p-3 rounded-2xl overflow-y-auto
                     border border-white/[.10] bg-[#0a1224]/95 backdrop-blur-xl
                     shadow-[0_18px_40px_-14px_rgba(0,0,0,0.7),0_0_28px_-10px_rgba(96,165,250,0.3)]`}
        >
          <p className="text-[10px] font-semibold text-white/35 uppercase tracking-widest mb-3">
            Settings
          </p>

          <SettingsToggle
            label={theme === "dark" ? "Dark mode" : "Light mode"}
            on={theme === "light"}
            onClick={toggleTheme}
            onColor="bg-gradient-to-r from-amber-400 to-orange-400 ring-white/20 shadow-[0_0_14px_-2px_rgba(251,191,36,0.8)]"
            thumbContent={theme === "light" ? "☀" : "☾"}
          />

          {/* Font size */}
          <div className="pt-3 mt-2 border-t border-white/[.06]">
            <p className="text-[11px] text-white/55 mb-2">Font size</p>
            <div className="grid grid-cols-3 gap-1">
              {([
                ["small",    "S",   "text-[11px]"],
                ["medium",   "M",   "text-[13px]"],
                ["large",    "L",   "text-[15px]"],
                ["xlarge",   "XL",  "text-[15px]"],
                ["xxlarge",  "2XL", "text-[15px]"],
                ["xxxlarge", "3XL", "text-[15px]"],
              ] as const).map(([size, label, sizeCls]) => (
                <button
                  key={size}
                  onClick={() => setFontSize(size)}
                  className={`relative rounded-lg py-1.5 transition-colors ${sizeCls} font-semibold
                              border
                    ${fontSize === size
                      ? "text-blue-200 border-blue-400/40 bg-gradient-to-r from-blue-500/30 to-indigo-500/25"
                      : "text-white/55 hover:text-white/85 border-white/[.06] hover:border-white/[.15]"}`}
                  aria-pressed={fontSize === size}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* About creator — link */}
          <button
            onClick={onAbout}
            className="mt-3 pt-3 border-t border-white/[.06] w-full text-left text-[12px]
                       text-white/65 hover:text-white transition-colors flex items-center gap-2"
          >
            <span className="w-4 h-4 rounded-md flex items-center justify-center
                             bg-gradient-to-br from-blue-500 to-purple-600 text-white
                             text-[9px] font-bold">P</span>
            About the creator
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SettingsToggle({
  label, on, onClick, onColor, thumbContent,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  onColor: string;
  thumbContent?: string;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer group py-1.5">
      <span className="text-[13px] text-white/65 group-hover:text-white/95 transition-colors">
        {label}
      </span>
      <button
        onClick={onClick}
        className={`relative w-10 h-5 rounded-full transition-colors duration-300 ring-1 ring-inset
          ${on ? onColor : "bg-white/[.10] ring-white/15"}`}
        aria-pressed={on}
      >
        <motion.span
          animate={{ x: on ? 22 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute top-0.5 left-0 w-4 h-4 rounded-full
                     bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] ring-1 ring-black/5
                     flex items-center justify-center text-[9px] text-slate-700"
        >
          {thumbContent ?? ""}
        </motion.span>
      </button>
    </label>
  );
}

/* ───── Icons ────────────────────────────────────────────────────────────── */
function IconWrap({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none"
         stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function HomeIcon() {
  return <IconWrap><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /></IconWrap>;
}
function StarIcon() {
  return <IconWrap><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.7-5.2 2.7 1-5.9-4.3-4.2 5.9-.9z" /></IconWrap>;
}
function BookIcon() {
  return <IconWrap>
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" />
    <path d="M20 19v3H6.5a2.5 2.5 0 0 1 0-5H20" />
  </IconWrap>;
}
function TranslateIcon() {
  return <IconWrap>
    <path d="M4 6h10" /><path d="M9 4v2" /><path d="M5 10c1.5 4 4.5 6 8 6" />
    <path d="M13 8c-1 4-4 6-7 6" />
    <path d="M14 20l4-9 4 9" /><path d="M15.5 17h5" />
  </IconWrap>;
}
function SparkIcon() {
  return <IconWrap>
    <path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" />
    <path d="M5.6 5.6l2.8 2.8" /><path d="M15.6 15.6l2.8 2.8" />
    <path d="M5.6 18.4l2.8-2.8" /><path d="M15.6 8.4l2.8-2.8" />
  </IconWrap>;
}
function GearIcon() {
  return <IconWrap>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </IconWrap>;
}
