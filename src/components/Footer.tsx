import { FileImage, FileText, Globe2, Waves } from "lucide-react";
import Logo from "./Logo";
import { GithubIcon } from "./icons";
import { fmtFullDate, fmtTime } from "../lib/model";
import { EVENTS, emit } from "../lib/events";

const NAV = [
  { href: "#forecast", label: "Forecast" },
  { href: "#regions", label: "Regions" },
  { href: "#factors", label: "Factors" },
  { href: "#about", label: "About" },
];

const REPO_URL = "https://github.com/LoBot-LLC/TecnoIndicator";

interface FooterProps {
  lastUpdated: Date;
}

export default function Footer({ lastUpdated }: FooterProps) {
  return (
    <footer className="border-t border-line bg-panel/40">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600 dark:text-slate-600 dark:text-slate-400">
              Real-time 10-year forecasts for global oil, electricity & water prices — with
              five-region evaluation across Americas, Europe, Asia, Africa and Oceania. Computed
              entirely in your browser from publicly known drivers.
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2.5 rounded-xl border border-line bg-panel/5 px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200 transition-all duration-200 hover:border-teal-400/40 hover:text-teal-600 dark:hover:text-teal-200"
            >
              <GithubIcon className="h-4 w-4" />
              View source on GitHub
            </a>
          </div>

          <nav aria-label="Footer">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600 dark:text-slate-600 dark:text-slate-400">
              Navigate
            </p>
            <ul className="mt-4 space-y-2.5">
              {NAV.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="text-sm text-slate-600 transition-colors hover:text-teal-600 dark:text-slate-600 dark:text-slate-400 dark:hover:text-teal-200"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600 dark:text-slate-600 dark:text-slate-400">
              Resources
            </p>
            <ul className="mt-4 space-y-2.5">
              <li>
                <button
                  type="button"
                  onClick={() => emit(EVENTS.EXPORT_PNG)}
                  className="flex items-center gap-2 text-sm text-slate-600 transition-colors hover:text-oil dark:text-slate-600 dark:text-slate-400"
                >
                  <FileImage className="h-4 w-4" /> Download chart (PNG)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => emit(EVENTS.EXPORT_CSV)}
                  className="flex items-center gap-2 text-sm text-slate-600 transition-colors hover:text-water dark:text-slate-600 dark:text-slate-400"
                >
                  <FileText className="h-4 w-4" /> Download data (CSV)
                </button>
              </li>
              <li>
                <a
                  href="#regions"
                  className="flex items-center gap-2 text-sm text-slate-600 transition-colors hover:text-teal-600 dark:text-slate-600 dark:text-slate-400 dark:hover:text-teal-200"
                >
                  <Globe2 className="h-4 w-4" /> Regional evaluation
                </a>
              </li>
              <li>
                <a
                  href="#forecast"
                  className="flex items-center gap-2 text-sm text-slate-600 transition-colors hover:text-teal-600 dark:text-slate-600 dark:text-slate-400 dark:hover:text-teal-200"
                >
                  <Waves className="h-4 w-4" /> Live water price
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-line pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-600 dark:text-slate-600 dark:text-slate-400">
            <span suppressHydrationWarning>© {new Date().getFullYear()}</span> TecnoIndicator{" "}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-600 dark:text-slate-400">
            Last updated:{" "}
            <span suppressHydrationWarning>
              {fmtFullDate(lastUpdated)} · {fmtTime(lastUpdated)}
            </span>{" "}
            · Model uses publicly available drivers.
          </p>
        </div>
      </div>
    </footer>
  );
}