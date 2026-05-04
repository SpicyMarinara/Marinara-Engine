// ──────────────────────────────────────────────
// Game: Readable Display (Notes & Books)
//
// Shows a fullscreen overlay with stylized text
// when the GM wraps content in [Note: ...] or [Book: ...].
// 5 random visual styles per type.
// ──────────────────────────────────────────────
import { useMemo } from "react";
import { X } from "lucide-react";
import DOMPurify from "dompurify";
import { cn } from "../../lib/utils";

interface GameReadableDisplayProps {
  type: "note" | "book";
  content: string;
  onClose: () => void;
}

const NOTE_STYLES = [
  {
    name: "parchment",
    wrapper: "bg-[#f5e6c8] text-[#3d2b1f] shadow-[0_4px_30px_rgba(0,0,0,0.5)]",
    inner: "font-serif italic leading-relaxed",
    border: "border-2 border-[#c4a76c]",
    accent: "bg-[#c4a76c]/20",
    heading: "text-[#6b4423] font-serif",
    closeBtn: "text-[#6b4423]/60 hover:text-[#6b4423]",
  },
  {
    name: "torn",
    wrapper: "bg-[#e8dcc8] text-[#4a3728] shadow-[0_8px_40px_rgba(0,0,0,0.6)] rotate-1",
    inner: "font-mono text-sm leading-loose tracking-wide",
    border: "border border-[#b8a88a] border-dashed",
    accent: "bg-[#b8a88a]/15",
    heading: "text-[#7a5c3a] font-mono uppercase tracking-[0.2em]",
    closeBtn: "text-[#7a5c3a]/60 hover:text-[#7a5c3a]",
  },
  {
    name: "wax-sealed",
    wrapper: "bg-[#faf0e0] text-[#2d1f14] shadow-[0_4px_24px_rgba(139,69,19,0.3)]",
    inner: "font-serif leading-relaxed text-base",
    border: "border-2 border-[#8b4513]/30 rounded-sm",
    accent: "bg-[#8b4513]/5",
    heading: "text-[#8b4513] font-serif tracking-wide",
    closeBtn: "text-[#8b4513]/50 hover:text-[#8b4513]",
  },
  {
    name: "charred",
    wrapper: "bg-[#2a2018] text-[#c9a96e] shadow-[0_0_40px_rgba(201,169,110,0.15)]",
    inner: "font-serif italic leading-relaxed opacity-90",
    border: "border border-[#c9a96e]/20",
    accent: "bg-[#c9a96e]/5",
    heading: "text-[#c9a96e] font-serif",
    closeBtn: "text-[#c9a96e]/50 hover:text-[#c9a96e]",
  },
  {
    name: "official",
    wrapper: "bg-[#fefefe] text-[#1a1a2e] shadow-[0_8px_32px_rgba(0,0,0,0.4)]",
    inner: "font-sans leading-relaxed text-sm",
    border: "border border-[#1a1a2e]/30 ring-1 ring-[#1a1a2e]/10",
    accent: "bg-[#1a1a2e]/5",
    heading: "text-[#1a1a2e] font-sans font-bold uppercase tracking-wide",
    closeBtn: "text-[#1a1a2e]/40 hover:text-[#1a1a2e]",
  },
];

const BOOK_STYLES = [
  {
    name: "leather-bound",
    wrapper: "bg-[#1c1410] text-[#d4c5a9] shadow-[0_8px_40px_rgba(0,0,0,0.7)]",
    inner: "font-serif leading-loose text-base",
    border: "border-2 border-[#8b6914]/40 rounded-lg",
    accent: "bg-[#8b6914]/10",
    heading: "text-[#d4a574] font-serif italic",
    closeBtn: "text-[#d4a574]/50 hover:text-[#d4a574]",
  },
  {
    name: "arcane",
    wrapper: "bg-[#0d0d1a] text-[#b8a9ff] shadow-[0_0_60px_rgba(138,100,255,0.15)]",
    inner: "font-serif leading-loose tracking-wide",
    border: "border border-[#6c5ce7]/30",
    accent: "bg-[#6c5ce7]/10",
    heading: "text-[#a29bfe] font-serif",
    closeBtn: "text-[#a29bfe]/40 hover:text-[#a29bfe]",
  },
  {
    name: "ancient-tome",
    wrapper: "bg-[#2d2416] text-[#e0d5b8] shadow-[0_4px_30px_rgba(0,0,0,0.6)]",
    inner: "font-serif italic leading-loose text-base",
    border: "border-2 border-[#a08850]/30",
    accent: "bg-[#a08850]/10",
    heading: "text-[#c9a96e] font-serif tracking-wider",
    closeBtn: "text-[#c9a96e]/50 hover:text-[#c9a96e]",
  },
  {
    name: "fairy-tale",
    wrapper: "bg-[#fef9f0] text-[#2d1f14] shadow-[0_8px_40px_rgba(0,0,0,0.3)]",
    inner:
      "font-serif text-base leading-loose first-letter:text-4xl first-letter:font-bold first-letter:float-left first-letter:mr-2 first-letter:text-[#8b4513]",
    border: "border-2 border-[#d4a574]/40 rounded-xl",
    accent: "bg-[#d4a574]/10",
    heading: "text-[#8b4513] font-serif italic",
    closeBtn: "text-[#8b4513]/50 hover:text-[#8b4513]",
  },
  {
    name: "forbidden",
    wrapper: "bg-[#0a0a0a] text-[#cc3333] shadow-[0_0_50px_rgba(204,51,51,0.1)]",
    inner: "font-mono leading-relaxed text-sm",
    border: "border border-[#cc3333]/20",
    accent: "bg-[#cc3333]/5",
    heading: "text-[#ff4444] font-mono uppercase tracking-[0.3em]",
    closeBtn: "text-[#cc3333]/40 hover:text-[#cc3333]",
  },
];

/** Deterministic hash to pick a consistent style for the same content */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function GameReadableDisplay({ type, content, onClose }: GameReadableDisplayProps) {
  const style = useMemo(() => {
    const styles = type === "note" ? NOTE_STYLES : BOOK_STYLES;
    return styles[simpleHash(content) % styles.length]!;
  }, [type, content]);

  const formattedContent = useMemo(() => {
    const html = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/gs, "<em>$1</em>")
      .replace(/\n/g, "<br />");
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: ["strong", "em", "br"] });
  }, [content]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div
        className={cn(
          "relative mx-4 flex max-h-[75vh] w-full max-w-lg flex-col overflow-hidden rounded-xl p-0",
          style.wrapper,
          style.border,
        )}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className={cn("absolute right-3 top-3 z-10 rounded-lg p-1.5 transition-colors", style.closeBtn)}
        >
          <X size={16} />
        </button>

        {/* Type label */}
        <div className={cn("px-6 pt-5 pb-2", style.accent)}>
          <span className={cn("text-[0.65rem] font-semibold uppercase tracking-[0.15em]", style.heading)}>
            {type === "note" ? "Note" : "Book"}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div
            className={cn("whitespace-pre-wrap", style.inner)}
            dangerouslySetInnerHTML={{ __html: formattedContent }}
          />
        </div>
      </div>
    </div>
  );
}
