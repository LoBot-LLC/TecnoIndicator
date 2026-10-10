interface LogoProps {
  onClick?: () => void;
}

export default function Logo({ onClick }: LogoProps) {
  return (
    <a
      href="#top"
      onClick={onClick}
      className="group inline-flex items-center gap-2.5"
      aria-label="LoBot LLC home"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-teal-400/30 bg-teal-400/10 text-teal-400 dark:text-teal-300 shadow-[0_0_24px_rgba(45,212,191,0.18)] transition-transform duration-300 group-hover:scale-105">
        <svg
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-4.5 w-4.5"
          aria-hidden="true"
        >
          {/* Robot head outline */}
          <path
            d="M24 4C15.16 4 8 11.16 8 20V28C8 32.4 10.4 36.4 14 38.4V42H34V38.4C37.6 36.4 40 32.4 40 28V20C40 11.16 32.84 4 24 4Z"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          {/* Left ear/antenna */}
          <path d="M8 16H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="6" cy="16" r="1.5" fill="currentColor" />
          {/* Right ear/antenna */}
          <path d="M40 16H42" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="42" cy="16" r="1.5" fill="currentColor" />
          {/* Circuit nodes inside head */}
          <circle cx="18" cy="14" r="2" fill="currentColor" />
          <circle cx="30" cy="14" r="2" fill="currentColor" />
          <circle cx="24" cy="20" r="2" fill="currentColor" />
          <circle cx="18" cy="26" r="2" fill="currentColor" />
          <circle cx="30" cy="26" r="2" fill="currentColor" />
          {/* Circuit connections */}
          <path d="M18 14L24 20L30 14" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M18 14L18 26" stroke="currentColor" strokeWidth="1.5" />
          <path d="M30 14L30 26" stroke="currentColor" strokeWidth="1.5" />
          <path d="M18 26L24 20" stroke="currentColor" strokeWidth="1.5" />
          <path d="M30 26L24 20" stroke="currentColor" strokeWidth="1.5" />
          {/* Arrow pointing into head from left */}
          <path d="M4 30L12 30" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M10 27L14 30L10 33" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
          {/* Mouth/face line */}
          <path d="M18 32H30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <span className="font-display text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        LoBot
        <span className="text-teal-400 dark:text-teal-300">LLC</span>
      </span>
    </a>
  );
}