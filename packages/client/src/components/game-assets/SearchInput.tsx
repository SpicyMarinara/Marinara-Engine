// ──────────────────────────────────────────────
// File Browser — Search input (responsive)
// ──────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Responsive search input for the file browser.
 *
 * Desktop: always-visible 192px input on the right.
 * Mobile: collapsed to a search-icon button; expands inline when tapped.
 * @param search - Current query string
 * @param onSearch - Callback when query changes
 */
export function SearchInput({ search, onSearch }: { search: string; onSearch: (v: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  return (
    <div className="relative ml-auto flex items-center">
      {/* Mobile collapsed state */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="rounded-lg border border-(--border) bg-(--background) p-1.5 text-(--muted-foreground) transition-colors hover:bg-(--accent) hover:text-(--foreground) sm:hidden"
          title="Search in folder"
        >
          <Search size="0.875rem" />
        </button>
      )}

      {/* Expanded input (always shown on desktop) */}
      <div className={cn("relative", !expanded && "hidden sm:block")}>
        <Search size="0.875rem" className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onBlur={() => {
            if (!search) setExpanded(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setExpanded(false);
              onSearch("");
            }
          }}
          placeholder="Search in folder..."
          className="h-8 w-48 rounded-lg border border-(--border) bg-(--background) pl-7 pr-7 text-sm text-(--foreground) outline-none transition-colors focus:border-(--primary)/50 focus:ring-1 focus:ring-(--primary)/20 max-sm:absolute max-sm:right-0 max-sm:top-1/2 max-sm:w-48 max-sm:-translate-y-1/2"
        />
        {expanded && (
          <button
            onClick={() => {
              setExpanded(false);
              onSearch("");
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-(--muted-foreground) hover:bg-(--accent) hover:text-(--foreground) sm:hidden"
          >
            <X size="0.75rem" />
          </button>
        )}
      </div>
    </div>
  );
}
