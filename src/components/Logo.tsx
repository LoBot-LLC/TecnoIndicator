import { Activity } from "lucide-react";
import Image from "next/image";

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
          <Image
            src="/LoBot-Trademark.png"
            alt="LoBot"
            width={40}
            height={40}
            className="h-10 w-10 object-contain"
          />
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