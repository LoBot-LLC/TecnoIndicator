interface LogoProps {
  onClick?: () => void;
}

export default function Logo({ onClick }: LogoProps) {
  return (
    <a
      href="#top"
      onClick={onClick}
      className="group inline-flex flex-col items-center gap-2"
      aria-label="LoBot home"
    >
      <span className="flex h-20 w-20 items-center justify-center rounded-2xl border border-teal-400/30 bg-teal-400/10 text-teal-400 dark:text-teal-300 shadow-[0_0_24px_rgba(45,212,191,0.18)] transition-transform duration-300 group-hover:scale-105">
        <svg
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-14 w-14"
          aria-hidden="true"
        >
          {/* Robot head outline - rounded helmet shape */}
          <path
            d="M60 10C38 10 20 28 20 50V62C20 73 26 83 35 88V98H85V88C94 83 100 73 100 62V50C100 28 82 10 60 10Z"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          {/* Left ear/antenna protrusion */}
          <path d="M20 42H14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle cx="14" cy="42" r="3" fill="currentColor" />
          {/* Right ear/antenna protrusion */}
          <path d="M100 42H106" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle cx="106" cy="42" r="3" fill="currentColor" />
          {/* Neck/collar at bottom */}
          <path
            d="M44 88H76V98H44Z"
            fill="currentColor"
            fillOpacity="0.3"
          />
          <path d="M44 88H76" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          {/* Arrow pointing into head from left */}
          <path d="M8 68L30 68" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <path d="M24 62L32 68L24 74" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" fill="none" />
          {/* Circuit nodes inside head */}
          <circle cx="48" cy="36" r="4" fill="currentColor" />
          <circle cx="72" cy="36" r="4" fill="currentColor" />
          <circle cx="60" cy="52" r="4" fill="currentColor" />
          <circle cx="48" cy="68" r="4" fill="currentColor" />
          <circle cx="72" cy="68" r="4" fill="currentColor" />
          {/* Circuit connections - branching pattern */}
          <path d="M48 36L60 52L72 36" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M48 36L48 68" stroke="currentColor" strokeWidth="2.5" />
          <path d="M72 36L72 68" stroke="currentColor" strokeWidth="2.5" />
          <path d="M48 68L60 52" stroke="currentColor" strokeWidth="2.5" />
          <path d="M72 68L60 52" stroke="currentColor" strokeWidth="2.5" />
          {/* Mouth/face line */}
          <path d="M48 80H72" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
      <span className="font-display text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        LoBot
      </span>
    </a>
  );
}