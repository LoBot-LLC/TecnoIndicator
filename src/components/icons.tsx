interface IconProps {
  className?: string;
}

/** LoBot logo mark (from images/lobotlogoonly.svg). */
export function LoBotIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g stroke="#5eead4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 16c4-4 9-6 15-6 9 0 16 6 17 14 .3 3 2 4 3 6l-2 4 .5 4c.2 2-1.2 3-3 3l-5-.5-1 6" />
        <path d="M16 23a7 7 0 0 0 0 12" />
        <path d="M10 21h8l3 3M27 27h7l5-5M31 31v5l3 3h5" />
      </g>
      <path d="M23 39v16l12-5v-8z" fill="#0d9488" />
      <g stroke="#ffffff" strokeWidth="2.4">
        <circle cx="24" cy="27" r="2.6" />
        <circle cx="41" cy="20" r="2.4" />
        <circle cx="31" cy="31" r="2.2" />
      </g>
    </svg>
  );
}

/** TecnoIndicator waveform mark (from images/lobottecnoindicator.svg). */
export function TecnoIndicatorIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="lobottecnoindicator-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="55%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#0d9488" />
        </linearGradient>
      </defs>
      <path
        d="M14 34 L24 34 L28 22 L34 48 L40 34 L50 34"
        stroke="url(#lobottecnoindicator-gradient)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** GitHub mark (not part of lucide's current icon set). */
export function GithubIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.26.82-.577 0-.285-.01-1.04-.016-2.04-3.338.726-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.757-1.333-1.757-1.09-.745.083-.73.083-.73 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.76-1.605-2.665-.303-5.466-1.333-5.466-5.93 0-1.31.468-2.382 1.236-3.222-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.3 1.23a11.5 11.5 0 0 1 3.003-.404c1.02.005 2.047.138 3.003.404 2.29-1.552 3.297-1.23 3.297-1.23.653 1.652.241 2.873.118 3.176.77.84 1.235 1.912 1.235 3.222 0 4.61-2.804 5.624-5.476 5.921.43.372.814 1.102.814 2.222 0 1.606-.015 2.898-.015 3.293 0 .32.216.694.825.576C20.565 21.796 24 17.297 24 12 24 5.37 18.63 0 12 0z" />
    </svg>
  );
}
