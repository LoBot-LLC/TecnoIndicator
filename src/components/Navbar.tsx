import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileImage, FileText, Menu, X } from "lucide-react";
import Logo from "./Logo";
import { GithubIcon } from "./icons";
import { EVENTS, emit } from "../lib/events";
import CurrencySelector from "./CurrencySelector";

const LINKS = [
  { href: "#forecast", label: "Forecast" },
  { href: "#regions", label: "Regions" },
  { href: "#factors", label: "Factors" },
  { href: "#about", label: "About" },
];

const REPO_URL = "https://github.com/xfst14/TecnoIndicator";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExportOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const doExport = (kind: "png" | "csv") => {
    emit(kind === "png" ? EVENTS.EXPORT_PNG : EVENTS.EXPORT_CSV);
    setExportOpen(false);
    setMobileOpen(false);
  };

  return (
    <header
      id="top"
      className={`sticky top-0 z-50 border-b transition-all duration-300 ${
        scrolled
          ? "border-line bg-base/85 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
          : "border-transparent bg-base/40 backdrop-blur-md"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Logo onClick={() => setMobileOpen(false)} />

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-teal-200"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2.5 md:flex">
          {/* Currency selector */}
          <CurrencySelector className="mr-2" />

          {/* Export dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              aria-expanded={exportOpen}
              aria-haspopup="true"
              className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.03] px-4 py-2 text-sm font-medium text-slate-200 transition-all duration-200 hover:border-teal-400/40 hover:text-white"
            >
              <Download className="h-4 w-4 text-teal-300" />
              Export
              <ChevronDown
                className={`h-3.5 w-3.5 text-slate-500 transition-transform ${exportOpen ? "rotate-180" : ""}`}
              />
            </button>
            {exportOpen && (
              <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/50">
                <button
                  type="button"
                  onClick={() => doExport("png")}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-200 transition-colors hover:bg-teal-400/10 hover:text-teal-200"
                >
                  <FileImage className="h-4 w-4 text-oil" />
                  Chart as PNG
                </button>
                <button
                  type="button"
                  onClick={() => doExport("csv")}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-200 transition-colors hover:bg-teal-400/10 hover:text-teal-200"
                >
                  <FileText className="h-4 w-4 text-water" />
                  Data as CSV
                </button>
              </div>
            )}
          </div>

          {/* GitHub */}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="View source on GitHub"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white/[0.03] text-slate-300 transition-all hover:border-line-strong hover:text-white"
          >
            <GithubIcon className="h-4.5 w-4.5" />
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white/[0.03] text-slate-200 md:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile panel */}
      {mobileOpen && (
        <div className="border-t border-line bg-panel/95 px-5 py-4 backdrop-blur-xl md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/5 hover:text-teal-200"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => doExport("png")}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-line bg-white/[0.03] px-3 py-2.5 text-sm text-slate-200"
            >
              <FileImage className="h-4 w-4" /> PNG
            </button>
            <button
              type="button"
              onClick={() => doExport("csv")}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-line bg-white/[0.03] px-3 py-2.5 text-sm text-slate-200"
            >
              <FileText className="h-4 w-4" /> CSV
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

