// ──────────────────────────────────────────────
// Panel: User Personas
// ──────────────────────────────────────────────
import { useState, useRef, useCallback, useMemo } from "react";
import {
  usePersonas,
  useCreatePersona,
  useDeletePersona,
  useActivatePersona,
  useUploadPersonaAvatar,
} from "../../hooks/use-characters";
import { useUIStore } from "../../stores/ui.store";
import { Plus, Trash2, User, Loader2, Pencil, Camera, Star, ArrowUpDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";

type PersonaRow = {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  backstory: string;
  appearance: string;
  avatarPath: string | null;
  isActive: string | boolean;
  createdAt: string;
};

type SortOption = "name-asc" | "name-desc" | "newest" | "oldest" | "tokens";

function estimateTokens(p: PersonaRow): number {
  const text = [p.description, p.personality, p.scenario, p.backstory, p.appearance].join("");
  return Math.ceil(text.length / 4);
}

export function PersonasPanel() {
  const { data: personas, isLoading } = usePersonas();
  const createPersona = useCreatePersona();
  const deletePersona = useDeletePersona();
  const activatePersona = useActivatePersona();
  const uploadAvatar = useUploadPersonaAvatar();
  const openPersonaDetail = useUIStore((s) => s.openPersonaDetail);

  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarTargetId, setAvatarTargetId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("name-asc");

  const isActive = (p: PersonaRow) => p.isActive === true || p.isActive === "true";

  const handleCreate = () => {
    createPersona.mutate({ name: "New Persona", description: "" });
  };

  const handleAvatarClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setAvatarTargetId(id);
    fileRef.current?.click();
  };

  const handleAvatarUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !avatarTargetId) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        uploadAvatar.mutate({
          id: avatarTargetId,
          avatar: dataUrl,
          filename: `persona-${avatarTargetId}-${Date.now()}.${file.name.split(".").pop()}`,
        });
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [avatarTargetId, uploadAvatar],
  );

  const rawList = (personas as PersonaRow[] | undefined) ?? [];

  const list = useMemo(() => {
    const arr = [...rawList];
    switch (sort) {
      case "name-asc":
        return arr.sort((a, b) => a.name.localeCompare(b.name));
      case "name-desc":
        return arr.sort((a, b) => b.name.localeCompare(a.name));
      case "newest":
        return arr.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      case "oldest":
        return arr.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      case "tokens":
        return arr.sort((a, b) => estimateTokens(b) - estimateTokens(a));
      default:
        return arr;
    }
  }, [rawList, sort]);

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Header help */}
      <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        Your personas
        <HelpTooltip text="Personas are your different identities. The active persona determines how the AI refers to you and sees your description, personality, backstory, and appearance. Great for switching between different player characters!" />
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={handleCreate}
          disabled={createPersona.isPending}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all active:scale-[0.98] bg-gradient-to-r from-emerald-400 to-teal-500 text-white shadow-md shadow-emerald-400/15 hover:shadow-lg hover:shadow-emerald-400/25 disabled:opacity-50"
        >
          {createPersona.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          New Persona
        </button>
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="h-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--secondary)] py-2 pl-2.5 pr-7 text-[11px] outline-none transition-colors focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            title="Sort order"
          >
            <option value="name-asc">A-Z</option>
            <option value="name-desc">Z-A</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="tokens">Tokens</option>
          </select>
          <ArrowUpDown
            size={10}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
        </div>
      </div>

      {/* Hidden file input for avatar uploads */}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />

      {isLoading && (
        <div className="flex flex-col gap-2 py-2">
          {[1, 2].map((i) => (
            <div key={i} className="shimmer h-16 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && list.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="animate-float flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-teal-500/20">
            <User size={20} className="text-emerald-400" />
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">No personas yet — create one!</p>
        </div>
      )}

      <div className="stagger-children flex flex-col gap-1">
        {list.map((persona) => {
          const active = isActive(persona);

          return (
            <div
              key={persona.id}
              className={cn(
                "group flex items-center gap-3 rounded-xl p-2.5 transition-all hover:bg-[var(--sidebar-accent)] cursor-pointer",
                active && "ring-1 ring-emerald-400/40 bg-emerald-400/5",
              )}
              onClick={() => openPersonaDetail(persona.id)}
            >
              {/* Avatar */}
              <button
                onClick={(e) => handleAvatarClick(e, persona.id)}
                className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm group/avatar"
                title="Change avatar"
              >
                {persona.avatarPath ? (
                  <img src={persona.avatarPath} alt="" className="h-full w-full rounded-xl object-cover" />
                ) : (
                  <User size={16} />
                )}
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 opacity-0 transition-opacity group-hover/avatar:opacity-100">
                  <Camera size={12} className="text-white" />
                </div>
                {active && (
                  <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400 shadow-sm">
                    <Star size={8} className="text-white" />
                  </div>
                )}
              </button>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{persona.name}</div>
                <div className="truncate text-[11px] text-[var(--muted-foreground)]">
                  {persona.description || "No description"}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {!active && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      activatePersona.mutate(persona.id);
                    }}
                    className="rounded-lg p-1.5 text-emerald-400 transition-colors hover:bg-emerald-400/10"
                    title="Set as active"
                  >
                    <Star size={13} />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openPersonaDetail(persona.id);
                  }}
                  className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                  title="Edit"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePersona.mutate(persona.id);
                  }}
                  className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
