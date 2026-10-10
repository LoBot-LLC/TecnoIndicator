import { Activity } from "lucide-react";

interface LogoProps {
  onClick?: () => void;
}

export default function Logo({ onClick }: LogoProps) {
  return (
    <a
      href="#top"
      onClick={onClick}
      className="group inline-flex items-center gap-2.5"
      aria-label="TecnoIndicator home"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-teal-400/30 bg-teal-400/10 text-teal-400 dark:text-teal-300 shadow-[0_0_24px_rgba(45,212,191,0.18)] transition-transform duration-300 group-hover:scale-105">
        <Activity className="h-4.5 w-4.5" strokeWidth={2.4} />
      </span>
      <span className="font-display text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        Tecno
        <span className="text-teal-400 dark:text-teal-300">Indicator</span>
      </span>
    </a>
  );
}
