import { FileImage, FileText, Globe2, Waves } from "lucide-react";
import Logo from "./Logo";
import { GithubIcon, LinkedinIcon, LoBotIcon } from "./icons";
import { fmtFullDate, fmtTime } from "../lib/model";
import { EVENTS, emit } from "../lib/events";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/dictionaries";

const NAV: Array<{ href: string; labelKey: TranslationKey }> = [
  { href: "#forecast", labelKey: "footer.navForecast" },
  { href: "#regions", labelKey: "footer.navRegions" },
  { href: "#factors", labelKey: "footer.navFactors" },
  { href: "#about", labelKey: "footer.navAbout" },
];

const REPO_URL = "https://github.com/LoBot-LLC";
const COMPANY_URL = "https://lobotllc.vercel.app/";
const LINKEDIN_URL = "https://www.linkedin.com/company/lobot-llc";

interface FooterProps {
  lastUpdated: Date;
}

export default function Footer({ lastUpdated }: FooterProps) {
  const { t } = useLanguage();
  return (
    <footer className="border-t border-line bg-panel/40">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo variant="lobot" />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600 dark:text-slate-500">
              {t("footer.description")}
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={t("footer.githubAria")}
              className="mt-5 inline-flex items-center gap-2.5 rounded-xl border border-line bg-panel/5 px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 transition-all duration-200 hover:border-teal-400/40 hover:text-teal-600 dark:hover:text-teal-200"
            >
              <GithubIcon className="h-4 w-4" />
            </a>
            <a
              href={LINKEDIN_URL}
              aria-label={t("footer.linkedinAria")}
              className="mt-5 inline-flex items-center gap-2.5 rounded-xl border border-line bg-panel/5 px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 transition-all duration-200 hover:border-teal-400/40 hover:text-teal-600 dark:hover:text-teal-200"
            >
              <LinkedinIcon className="h-4 w-4" />
            </a>
            <a
              href={COMPANY_URL}
              rel="noreferrer"
              aria-label={t("footer.websiteAria")}
              className="mt-5 inline-flex items-center gap-2.5 rounded-xl border border-line bg-panel/5 px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 transition-all duration-200 hover:border-teal-400/40 hover:text-teal-600 dark:hover:text-teal-200"
            >
              <LoBotIcon className="h-4 w-4" />
            </a>
          </div>

          <nav aria-label={t("footer.navAria")}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600 dark:text-slate-500">
              {t("footer.navigate")}
            </p>
            <ul className="mt-4 space-y-2.5">
              {NAV.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="text-sm text-slate-600 transition-colors hover:text-teal-600 dark:text-slate-500 dark:hover:text-teal-200"
                  >
                    {t(l.labelKey)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600 dark:text-slate-500">
              {t("footer.resources")}
            </p>
            <ul className="mt-4 space-y-2.5">
              <li>
                <button
                  type="button"
                  onClick={() => emit(EVENTS.EXPORT_PNG)}
                  className="flex items-center gap-2 text-sm text-slate-600 transition-colors hover:text-oil dark:text-slate-500"
                >
                  <FileImage className="h-4 w-4" /> {t("footer.downloadPng")}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => emit(EVENTS.EXPORT_CSV)}
                  className="flex items-center gap-2 text-sm text-slate-600 transition-colors hover:text-water dark:text-slate-500"
                >
                  <FileText className="h-4 w-4" /> {t("footer.downloadCsv")}
                </button>
              </li>
              <li>
                <a
                  href="#regions"
                  className="flex items-center gap-2 text-sm text-slate-600 transition-colors hover:text-teal-600 dark:text-slate-500 dark:hover:text-teal-200"
                >
                  <Globe2 className="h-4 w-4" /> {t("footer.regional")}
                </a>
              </li>
              <li>
                <a
                  href="#forecast"
                  className="flex items-center gap-2 text-sm text-slate-600 transition-colors hover:text-teal-600 dark:text-slate-500 dark:hover:text-teal-200"
                >
                  <Waves className="h-4 w-4" /> {t("footer.liveWater")}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-line pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-600 dark:text-slate-500">
            <span suppressHydrationWarning>© {new Date().getFullYear()}</span> {t("footer.rights")}{" "}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-500">
            {t("footer.lastUpdated")}{" "}
            <span suppressHydrationWarning>
              {fmtFullDate(lastUpdated)} · {fmtTime(lastUpdated)}
            </span>{" "}
            · {t("common.modelNote")}
          </p>
        </div>
      </div>
    </footer>
  );
}
