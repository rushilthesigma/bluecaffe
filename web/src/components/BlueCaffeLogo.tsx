export function BlueCaffeLogo({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* steam wisps */}
      <path d="M8 4 Q8.5 2.5 8 1" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
      <path d="M12 4 Q12.5 2.5 12 1" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
      {/* cup body */}
      <path
        d="M5 7h14l-2 10H7L5 7Z"
        fill="var(--accent)"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* handle */}
      <path
        d="M19 9.5 Q23 9.5 23 13 Q23 16.5 19 16.5"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* saucer */}
      <path d="M4 18h16" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
