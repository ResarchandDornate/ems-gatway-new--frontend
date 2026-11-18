export function LoadingState({ message = "Loading…", rows = 5 }: { message?: string; rows?: number }) {
  return (
    <div className="w-full animate-pulse space-y-3 py-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-accent/70 animate-bounce [animation-delay:0ms]" />
        <div className="w-2 h-2 rounded-full bg-accent/70 animate-bounce [animation-delay:150ms]" />
        <div className="w-2 h-2 rounded-full bg-accent/70 animate-bounce [animation-delay:300ms]" />
        <span className="text-[11.5px] text-muted font-mono tracking-[1.4px] ml-1">{message}</span>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="h-9 rounded-lg bg-surface2 flex-shrink-0" style={{ width: `${60 + (i % 3) * 20}px` }} />
          <div className="h-9 rounded-lg bg-surface2 flex-1" style={{ opacity: 1 - i * 0.08 }} />
          <div className="h-9 rounded-lg bg-surface2 flex-shrink-0 w-24" />
        </div>
      ))}
    </div>
  );
}

export function LoadingSpinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24" fill="none"
      // accent, not the brand ramp: the ramp is fixed across themes and is
      // reserved for the logo, so a spinner drawn from it stayed pale cyan on
      // the light theme's white cards.
      className="animate-spin text-accent"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
