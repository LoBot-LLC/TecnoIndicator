import Image from "next/image";

interface LogoProps {
  onClick?: () => void;
}

export default function Logo({ onClick }: LogoProps) {
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
          width={32}
          height={32}
          className="h-7 w-7"
        />
      </span>
      <span className="font-display text-lg font-semibold tracking-tight text-blue-600 dark:text-blue-400">
        LoBot
      </span>
    </a>
  );
}