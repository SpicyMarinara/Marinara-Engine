export function TrackerSkeleton() {
  return (
    <div className="space-y-1 p-1">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-sm border border-[var(--border)]/65 bg-[var(--card)]/45 p-1">
          <div className="h-3 w-1/2 rounded bg-[var(--secondary)]" />
          <div className="mt-1.5 space-y-1">
            <div className="h-2.5 rounded bg-[var(--secondary)]/80" />
            <div className="h-2.5 w-3/4 rounded bg-[var(--secondary)]/70" />
          </div>
        </div>
      ))}
    </div>
  );
}
