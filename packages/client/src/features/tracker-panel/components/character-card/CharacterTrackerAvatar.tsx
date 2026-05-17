import { ImagePlus } from "lucide-react";
import type { PresentCharacter } from "@marinara-engine/shared";
import { cn } from "../../../../lib/utils";
import { visibleText } from "../../lib/tracker-display";

const AVATAR_BOTTOM_GLINT_CLASS =
  "pointer-events-none absolute -inset-[2px] z-[3] rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,transparent_0deg,transparent_104deg,color-mix(in_srgb,var(--tracker-profile-dialogue-border)_58%,transparent)_148deg,color-mix(in_srgb,var(--tracker-profile-accent-solid)_46%,transparent)_192deg,transparent_226deg,transparent_360deg)] opacity-90 shadow-[0_1px_4px_color-mix(in_srgb,var(--tracker-profile-accent-solid)_28%,transparent)] [mask:radial-gradient(farthest-side,transparent_calc(100%-3px),black_calc(100%-2px),black_100%)] [transform:rotate(-8deg)]";
const AVATAR_SOFT_INNER_GLOW_CLASS =
  "pointer-events-none absolute inset-[1px] z-[2] rounded-full bg-[radial-gradient(farthest-side,transparent_calc(100%-5px),color-mix(in_srgb,var(--tracker-profile-dialogue-border)_10%,transparent)_calc(100%-3px),color-mix(in_srgb,var(--tracker-profile-accent-solid)_9%,transparent)_calc(100%-1px),transparent_100%)] opacity-72";

export function CharacterTrackerAvatar({
  character,
  avatarMedia,
  avatarSize,
  onUploadAvatar,
}: {
  character: PresentCharacter;
  avatarMedia: string | null;
  avatarSize: string;
  onUploadAvatar?: () => void;
}) {
  return (
    <div className={cn("relative shrink-0", avatarSize)}>
      <button
        type="button"
        onClick={onUploadAvatar}
        disabled={!onUploadAvatar}
        title={avatarMedia ? "Change avatar" : "Upload avatar"}
        aria-label={
          avatarMedia
            ? `Change ${visibleText(character.name, "character")} avatar`
            : `Upload ${visibleText(character.name, "character")} avatar`
        }
        className={cn(
          "group/avatar relative z-[1] flex aspect-square w-full shrink-0 items-center justify-center overflow-hidden rounded-full border border-[color-mix(in_srgb,var(--tracker-profile-nameplate-rule)_34%,transparent)] bg-[var(--muted)] text-xs text-[var(--foreground)] shadow-[0_4px_10px_rgba(0,0,0,0.24)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]",
          onUploadAvatar && "cursor-pointer hover:ring-[var(--primary)]/36 active:scale-95",
          !onUploadAvatar && "cursor-default",
        )}
      >
        {avatarMedia ? (
          <img src={avatarMedia} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span className="text-xs leading-none">{character.emoji || "?"}</span>
        )}
        {onUploadAvatar && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--background)]/48 text-[var(--tracker-profile-icon)] opacity-0 backdrop-blur-[1px] transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100">
            <ImagePlus size="0.6875rem" />
          </span>
        )}
        <span aria-hidden="true" className={AVATAR_SOFT_INNER_GLOW_CLASS} />
      </button>
      <span aria-hidden="true" className={AVATAR_BOTTOM_GLINT_CLASS} />
    </div>
  );
}
