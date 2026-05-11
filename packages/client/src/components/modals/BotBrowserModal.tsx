// ──────────────────────────────────────────────
// Modal: Browser (browse & import characters from Chub)
// ──────────────────────────────────────────────
import { useState, useCallback, useEffect, useRef } from "react";
import { Modal } from "../ui/Modal";
import {
  Search,
  Star,
  MessageSquare,
  Hash,
  Download,
  Loader2,
  ChevronLeft,
  X,
  CheckCircle,
  ExternalLink,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { characterKeys } from "../../hooks/use-characters";
import { lorebookKeys } from "../../hooks/use-lorebooks";
import { parsePngCharacterCard } from "../../lib/png-parser";
import { confirmEmbeddedLorebookImport, readEmbeddedLorebookFromCharacterPayload } from "../../lib/character-import";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

type TagImportMode = "all" | "none" | "existing";

const TAG_IMPORT_OPTIONS: Array<{ value: TagImportMode; label: string; description: string }> = [
  { value: "all", label: "All tags", description: "Keep source tags." },
  { value: "none", label: "No tags", description: "Skip source tags." },
  { value: "existing", label: "Existing only", description: "Keep tags already in Marinara." },
];

// ── Chub API types ──

interface ChubCard {
  fullPath: string;
  name: string;
  tagline: string;
  description: string;
  topics: string[];
  starCount: number;
  nChats: number;
  nTokens: number;
  nsfw: boolean;
  nsfw_image: boolean;
}

interface ChubDefinition {
  personality: string;
  description: string;
  first_message: string;
  scenario: string;
  example_dialogs: string;
  alternate_greetings: string[];
  embedded_lorebook?: unknown;
}

interface ChubDetailNode extends ChubCard {
  definition: ChubDefinition;
}

const SORT_OPTIONS = [
  { value: "download_count", label: "Most Downloads" },
  { value: "star_count", label: "Most Stars" },
  { value: "default", label: "Trending" },
  { value: "created_at", label: "Newest" },
] as const;

function hasLorebookEntries(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const entries = (value as Record<string, unknown>).entries;
  if (Array.isArray(entries)) return entries.length > 0;
  return !!entries && typeof entries === "object" && Object.keys(entries).length > 0;
}

function attachEmbeddedLorebookToCharacterJson(raw: Record<string, unknown>, embeddedLorebook: unknown) {
  if (!hasLorebookEntries(embeddedLorebook)) return raw;

  const cloned: Record<string, unknown> = { ...raw };
  const target =
    (cloned.spec === "chara_card_v2" || cloned.spec === "chara_card_v3") &&
    cloned.data &&
    typeof cloned.data === "object"
      ? { ...(cloned.data as Record<string, unknown>) }
      : cloned;

  if (!target.character_book) {
    target.character_book = embeddedLorebook;
  }

  if (target !== cloned) {
    cloned.data = target;
  }

  return cloned;
}

export function BotBrowserModal({ open, onClose }: Props) {
  const qc = useQueryClient();

  // Search state
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("download_count");
  const [page, setPage] = useState(1);
  const [nsfw, setNsfw] = useState(false);

  // Results
  const [results, setResults] = useState<ChubCard[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail view
  const [selectedCard, setSelectedCard] = useState<ChubCard | null>(null);
  const [detail, setDetail] = useState<ChubDetailNode | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Import
  const [importing, setImporting] = useState(false);
  const [tagImportMode, setTagImportMode] = useState<TagImportMode>("all");

  // Search debounce
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doSearch = useCallback(async (q: string, p: number, s: string, n: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q,
        page: String(p),
        sort: s,
        nsfw: String(n),
      });
      const res = await fetch(`/api/bot-browser/chub/search?${params}`);
      if (!res.ok) throw new Error("Search failed");
      const raw = await res.json();
      // Chub wraps in { data: { nodes, count } } or sometimes { nodes, count }
      const data = raw?.data ?? raw;
      setResults(data?.nodes ?? []);
      setTotalCount(data?.count ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Run search on param changes (debounced for text input)
  useEffect(() => {
    if (!open) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => doSearch(query, page, sort, nsfw), query ? 400 : 0);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [open, query, page, sort, nsfw, doSearch]);

  // Load character detail
  const openDetail = async (card: ChubCard) => {
    setSelectedCard(card);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/bot-browser/chub/character/${card.fullPath}`);
      if (!res.ok) throw new Error("Failed to load character");
      const raw = await res.json();
      const node = raw?.data?.node ?? raw?.node;
      if (!node) throw new Error("Invalid character data");
      setDetail(node);
    } catch {
      toast.error("Failed to load character details");
      setSelectedCard(null);
    } finally {
      setDetailLoading(false);
    }
  };

  // Import character via PNG download → parse → import
  const handleImport = async (fullPath: string) => {
    setImporting(true);
    try {
      const res = await fetch(`/api/bot-browser/chub/download/${fullPath}`);
      if (!res.ok) throw new Error("Failed to download character card");
      const blob = await res.blob();
      const file = new File([blob], "character.png", { type: "image/png" });

      const { json, imageDataUrl } = await parsePngCharacterCard(file);
      let cardDetail = detail?.fullPath === fullPath ? detail : null;
      if (!cardDetail) {
        const detailRes = await fetch(`/api/bot-browser/chub/character/${fullPath}`);
        if (detailRes.ok) {
          const rawDetail = await detailRes.json();
          cardDetail = rawDetail?.data?.node ?? rawDetail?.node ?? null;
        }
      }
      const importJson = attachEmbeddedLorebookToCharacterJson(
        json as Record<string, unknown>,
        cardDetail?.definition?.embedded_lorebook,
      );
      const importEmbeddedLorebook = confirmEmbeddedLorebookImport(
        cardDetail?.name ?? "This character",
        cardDetail?.definition?.embedded_lorebook ?? readEmbeddedLorebookFromCharacterPayload(importJson),
      );

      const importRes = await fetch("/api/import/st-character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...importJson, _avatarDataUrl: imageDataUrl, importEmbeddedLorebook, tagImportMode }),
      });
      const data = await importRes.json();

      if (data.success) {
        toast.success(`Imported "${data.name ?? "character"}" successfully!`);
        qc.invalidateQueries({ queryKey: characterKeys.list() });
        if (data.lorebook) {
          qc.invalidateQueries({ queryKey: lorebookKeys.all });
        }
      } else {
        throw new Error(data.error ?? "Import failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const avatarUrl = (fullPath: string) => `/api/bot-browser/chub/avatar/${fullPath}`;

  const totalPages = Math.ceil(totalCount / 48);

  // Reset detail when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedCard(null);
      setDetail(null);
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Browser" width="max-w-5xl">
      <div className="flex flex-col gap-4" style={{ minHeight: "60vh" }}>
        {selectedCard ? (
          <DetailView
            card={selectedCard}
            detail={detail}
            loading={detailLoading}
            importing={importing}
            avatarUrl={avatarUrl}
            onBack={() => {
              setSelectedCard(null);
              setDetail(null);
            }}
            onImport={handleImport}
            tagImportMode={tagImportMode}
            onTagImportModeChange={setTagImportMode}
          />
        ) : (
          <>
            {/* Search toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search
                  size="0.875rem"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search characters..."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] py-2 pl-9 pr-8 text-sm text-[var(--foreground)] placeholder-[var(--muted-foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    <X size="0.75rem" />
                  </button>
                )}
              </div>

              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <label className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={nsfw}
                  onChange={(e) => {
                    setNsfw(e.target.checked);
                    setPage(1);
                  }}
                  className="accent-[var(--primary)]"
                />
                NSFW
              </label>
            </div>

            {/* Results */}
            {loading ? (
              <div className="flex flex-1 items-center justify-center py-12">
                <Loader2 size="1.5rem" className="animate-spin text-[var(--muted-foreground)]" />
              </div>
            ) : error ? (
              <div className="flex flex-1 items-center justify-center py-12 text-sm text-[var(--destructive)]">
                {error}
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-1 items-center justify-center py-12 text-sm text-[var(--muted-foreground)]">
                No characters found
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {results.map((card) => (
                    <CardTile key={card.fullPath} card={card} avatarUrl={avatarUrl} onClick={() => openDetail(card)} />
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Card tile in the grid ──

function CardTile({
  card,
  avatarUrl,
  onClick,
}: {
  card: ChubCard;
  avatarUrl: (path: string) => string;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const creator = card.fullPath.split("/")[0] ?? "";

  return (
    <button
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-left transition-all hover:border-[var(--primary)]/40 hover:shadow-lg hover:shadow-black/20 active:scale-[0.98]"
    >
      {/* Avatar */}
      <div className="relative aspect-square w-full overflow-hidden bg-[var(--secondary)]">
        {imgError ? (
          <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]">
            <Hash size="2rem" />
          </div>
        ) : (
          <img
            src={avatarUrl(card.fullPath)}
            alt={card.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            onError={() => setImgError(true)}
          />
        )}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="truncate text-sm font-semibold text-[var(--foreground)]">{card.name}</h3>
        <p className="truncate text-xs text-[var(--muted-foreground)]">by {creator}</p>
        {card.tagline && (
          <p className="line-clamp-2 text-xs text-[var(--muted-foreground)] opacity-70">{card.tagline}</p>
        )}

        {/* Stats row */}
        <div className="mt-auto flex items-center gap-2 pt-1.5 text-[0.65rem] text-[var(--muted-foreground)]">
          <span className="flex items-center gap-0.5" title="Stars">
            <Star size="0.625rem" /> {card.starCount}
          </span>
          <span className="flex items-center gap-0.5" title="Chats">
            <MessageSquare size="0.625rem" /> {card.nChats}
          </span>
          {card.nTokens > 0 && (
            <span className="flex items-center gap-0.5" title="Tokens">
              <Hash size="0.625rem" /> {formatTokens(card.nTokens)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Detail view ──

function DetailView({
  card,
  detail,
  loading,
  importing,
  avatarUrl,
  onBack,
  onImport,
  tagImportMode,
  onTagImportModeChange,
}: {
  card: ChubCard;
  detail: ChubDetailNode | null;
  loading: boolean;
  importing: boolean;
  avatarUrl: (path: string) => string;
  onBack: () => void;
  onImport: (fullPath: string) => void;
  tagImportMode: TagImportMode;
  onTagImportModeChange: (mode: TagImportMode) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const creator = card.fullPath.split("/")[0] ?? "";
  const def = detail?.definition;

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <ChevronLeft size="0.875rem" /> Back
        </button>
        <div className="flex-1" />
        <a
          href={`https://chub.ai/characters/${card.fullPath}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <ExternalLink size="0.75rem" /> View on Chub
        </a>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size="1.5rem" className="animate-spin text-[var(--muted-foreground)]" />
        </div>
      ) : (
        <div className="flex gap-5 max-md:flex-col">
          {/* Left column: Avatar + actions */}
          <div className="flex w-48 shrink-0 flex-col gap-3 max-md:w-full max-md:flex-row max-md:items-start">
            <div className="aspect-square w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--secondary)] max-md:w-32">
              {imgError ? (
                <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]">
                  <Hash size="2.5rem" />
                </div>
              ) : (
                <img
                  src={avatarUrl(card.fullPath)}
                  alt={card.name}
                  className="h-full w-full object-cover"
                  onError={() => setImgError(true)}
                />
              )}
            </div>

            <div className="flex flex-col gap-2 max-md:flex-1">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 p-2.5">
                <p className="mb-2 text-[0.6875rem] font-semibold text-[var(--foreground)]">Imported tags</p>
                <div className="flex flex-col gap-1.5">
                  {TAG_IMPORT_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`cursor-pointer rounded-md border px-2 py-1.5 transition-colors ${
                        tagImportMode === option.value
                          ? "border-[var(--primary)] bg-[var(--primary)]/10"
                          : "border-[var(--border)] hover:border-[var(--muted-foreground)]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="botBrowserTagImportMode"
                        value={option.value}
                        checked={tagImportMode === option.value}
                        onChange={() => onTagImportModeChange(option.value)}
                        className="sr-only"
                      />
                      <span className="block text-[0.6875rem] font-medium">{option.label}</span>
                      <span className="block text-[0.5625rem] leading-snug text-[var(--muted-foreground)]">
                        {option.description}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={() => onImport(card.fullPath)}
                disabled={importing}
                className="flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                {importing ? <Loader2 size="0.875rem" className="animate-spin" /> : <Download size="0.875rem" />}
                {importing ? "Importing..." : "Import"}
              </button>

              {/* Stats */}
              <div className="flex flex-col gap-1 rounded-lg bg-[var(--secondary)] p-2.5 text-xs text-[var(--muted-foreground)]">
                <span className="flex items-center gap-1.5">
                  <Star size="0.75rem" /> {card.starCount} stars
                </span>
                <span className="flex items-center gap-1.5">
                  <MessageSquare size="0.75rem" /> {card.nChats} chats
                </span>
                {card.nTokens > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Hash size="0.75rem" /> {formatTokens(card.nTokens)} tokens
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right column: Character info */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div>
              <h3 className="text-lg font-bold text-[var(--foreground)]">{card.name}</h3>
              <p className="text-xs text-[var(--muted-foreground)]">by {creator}</p>
            </div>

            {card.tagline && <p className="text-sm text-[var(--foreground)]/80">{card.tagline}</p>}

            {/* Tags */}
            {(detail?.topics ?? card.topics)?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(detail?.topics ?? card.topics).slice(0, 20).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.65rem] text-[var(--muted-foreground)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Definition sections */}
            {def && (
              <div className="flex flex-col gap-3">
                {def.description && <DefinitionSection title="Description" content={def.description} />}
                {def.personality && <DefinitionSection title="Personality" content={def.personality} />}
                {def.scenario && <DefinitionSection title="Scenario" content={def.scenario} />}
                {def.first_message && <DefinitionSection title="First Message" content={def.first_message} />}
                {def.alternate_greetings?.length > 0 && (
                  <div>
                    <h4 className="mb-1 text-xs font-semibold text-[var(--foreground)]">
                      Alternate Greetings ({def.alternate_greetings.length})
                    </h4>
                    <div className="flex flex-col gap-1.5">
                      {def.alternate_greetings.map((g, i) => (
                        <div
                          key={i}
                          className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--secondary)] p-2.5 text-xs text-[var(--muted-foreground)]"
                        >
                          {g}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {def.example_dialogs && <DefinitionSection title="Example Dialogues" content={def.example_dialogs} />}
                {!!def.embedded_lorebook && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                    <CheckCircle size="0.75rem" /> Has embedded lorebook
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

function DefinitionSection({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-[var(--foreground)]">{title}</h4>
      <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--secondary)] p-2.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
        {content}
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
