import { LoBotIcon } from "./icons";

interface LogoProps {
  onClick?: () => void;
  variant?: "tecnoindicator" | "lobot";
}

export default function Logo({ onClick, variant = "tecnoindicator" }: LogoProps) {
  if (variant === "lobot") {
    return (
      <a
        href="#top"
        onClick={onClick}
        className="group inline-flex items-center gap-3"
        aria-label="LoBot LLC home"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-teal-400/30 bg-teal-400/10 text-teal-400 dark:text-teal-300 shadow-[0_0_24px_rgba(45,212,191,0.18)] transition-transform duration-300 group-hover:scale-105">
          <LoBotIcon className="h-10 w-10" />
        </span>
        <span className="font-display text-lg font-semibold tracking-tight text-white">
          LoBot
        </span>
      </a>
    );
  }

  return (
    <a
      href="#top"
      onClick={onClick}
      className="group inline-flex items-center gap-2.5"
      aria-label="LoBot TecnoIndicator home"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-teal-400/30 bg-teal-400/10 text-teal-400 dark:text-teal-300 shadow-[0_0_24px_rgba(45,212,191,0.18)] transition-transform duration-300 group-hover:scale-105">
        <LoBotIcon className="h-9 w-9" />
      </span>
      <span className="font-display text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        LoBot
        <span className="text-teal-400 dark:text-teal-300"> TecnoIndicator</span>
      </span>
    </a>
  );
}
