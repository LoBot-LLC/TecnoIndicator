interface LogoProps {
  onClick?: () => void;
}

export default function Logo({ onClick }: LogoProps) {
  return (
    <a
      href="#top"
      onClick={onClick}
      className="group inline-flex flex-col items-center gap-3"
      aria-label="LoBot LLC home"
    >
      <span className="flex h-24 w-24 items-center justify-center rounded-2xl border border-teal-400/30 bg-teal-400/10 text-teal-400 dark:text-teal-300 shadow-[0_0_24px_rgba(45,212,191,0.18)] transition-transform duration-300 group-hover:scale-105">
        <svg
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-16 w-16"
          aria-hidden="true"
        >
          {/* Left ear/antenna C-shape protrusion */}
          <path
            d="M88 88C82 88 78 94 78 100C78 106 82 112 88 112"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
          />
          {/* Right connector protrusion (rectangular with rounded corners) */}
          <path
            d="M142 86H152C156 86 158 90 158 94C158 98 156 102 152 102H142"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
          />
          {/* Robot head outline - rounded helmet facing right */}
          <path
            d="M70 60C70 34 92 14 118 14C144 14 166 34 166 60C166 76 158 90 146 98L146 124C146 132 138 138 130 138H90C82 138 74 132 74 124L74 98C62 90 54 76 54 60C54 50 62 42 70 36Z"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinejoin="round"
          />
          {/* Neck/collar solid block at bottom */}
          <path
            d="M92 124L92 152L128 152L128 124"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinejoin="round"
          />
          {/* Arrow pointing into head from left */}
          <path
            d="M52 100L92 100"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <path
            d="M82 92L96 100L82 108"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Circuit nodes inside head - 5 circular nodes */}
          <circle cx="100" cy="54" r="6" fill="currentColor" />
          <circle cx="136" cy="54" r="6" fill="currentColor" />
          <circle cx="100" cy="86" r="6" fill="currentColor" />
          <circle cx="136" cy="86" r="6" fill="currentColor" />
          <circle cx="100" cy="114" r="6" fill="currentColor" />
          {/* Circuit connections - branching pattern matching trademark */}
          <path
            d="M100 54L100 86"
            stroke="currentColor"
            strokeWidth="5"
          />
          <path
            d="M136 54L136 86"
            stroke="currentColor"
            strokeWidth="5"
          />
          <path
            d="M100 86L136 86"
            stroke="currentColor"
            strokeWidth="5"
          />
          <path
            d="M100 86L100 114"
            stroke="currentColor"
            strokeWidth="5"
          />
          <path
            d="M100 114L136 86"
            stroke="currentColor"
            strokeWidth="5"
          />
          {/* Mouth/face line at bottom of head */}
          <path
            d="M112 124L136 124"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="font-display text-[18px] font-semibold tracking-tight">
        <span className="text-slate-900 dark:text-slate-100">LoBot</span>
        <span className="text-teal-400 dark:text-teal-300"> LLC</span>
      </span>
    </a>
  );
}