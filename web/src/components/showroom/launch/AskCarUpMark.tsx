/**
 * The Ask CarUp cue: a navy disc with an orange roofline arc and a spark. Used only beside
 * AI-assisted actions and output, so visitors learn one consistent sign for "CarUp AI helped here".
 * It is not the CarUp logo and never replaces it.
 */
export function AskCarUpMark({ size = 24, className = '', title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-testid="ask-carup-mark"
    >
      <defs>
        <linearGradient id="ask-carup-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FE7D18" />
          <stop offset="1" stopColor="#FFB27A" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill="#09122A" />
      <path d="M6.5 20.5c2.6-5.2 6-7.6 10.2-7.6 3.4 0 6.2 1.4 8.8 4.6" fill="none" stroke="url(#ask-carup-arc)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M22.6 6.2l.95 2.45 2.45.95-2.45.95-.95 2.45-.95-2.45-2.45-.95 2.45-.95z" fill="#FFB27A" />
    </svg>
  )
}
