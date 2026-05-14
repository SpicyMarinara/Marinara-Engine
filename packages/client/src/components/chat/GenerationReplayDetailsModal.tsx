import { stripGenerationGuideInstruction, type MessageExtra } from "@marinara-engine/shared";
import { Modal } from "../ui/Modal";

type GenerationReplay = NonNullable<MessageExtra["generationReplay"]>;
type GuideSource = NonNullable<GenerationReplay["generationGuideSource"]>;

const GUIDE_SOURCE_LABELS: Record<GuideSource, string> = {
  narrator: "/narrator",
  guide: "Guided regenerate",
  game_start: "Game start",
};

function storedText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function visibleGenerationGuide(replay: GenerationReplay | null): string | null {
  const guide = storedText(replay?.generationGuide);
  if (!guide) return null;
  return replay?.generationGuideSource === "narrator" || replay?.generationGuideSource === "guide"
    ? stripGenerationGuideInstruction(guide)
    : guide;
}

export function hasGenerationReplayDetails(value: unknown): value is GenerationReplay {
  if (!value || typeof value !== "object") return false;
  const replay = value as GenerationReplay;
  return replay.impersonate === true || storedText(replay.generationGuide) !== null;
}

function guideLabel(source: GenerationReplay["generationGuideSource"]): string {
  return source && source in GUIDE_SOURCE_LABELS ? GUIDE_SOURCE_LABELS[source as GuideSource] : "Stored guidance";
}

function TextBlock({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[0.75rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">{label}</h3>
      <pre
        className={`max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2 text-[0.8125rem] leading-relaxed ${
          muted ? "text-[var(--muted-foreground)]" : "text-[var(--foreground)]"
        }`}
      >
        {value}
      </pre>
    </section>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 text-[0.8125rem] max-sm:grid-cols-1 max-sm:gap-1">
      <dt className="font-medium text-[var(--muted-foreground)]">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-[var(--foreground)]">{value}</dd>
    </div>
  );
}

export function GenerationReplayDetailsModal({
  open,
  replay,
  onClose,
}: {
  open: boolean;
  replay: GenerationReplay | null;
  onClose: () => void;
}) {
  const generationGuide = visibleGenerationGuide(replay);
  const impersonateDirection = storedText(replay?.userMessage);
  const impersonateGuidance = hasGenerationReplayDetails(replay) && replay?.impersonate === true
    ? (generationGuide ?? impersonateDirection)
    : null;
  const impersonatePromptTemplate = storedText(replay?.impersonatePromptTemplate);
  const hasImpersonate = replay?.impersonate === true;
  const hasMetadata =
    hasImpersonate &&
    (storedText(replay?.impersonatePresetId) ||
      storedText(replay?.impersonateConnectionId) ||
      replay?.impersonateBlockAgents === true);

  return (
    <Modal open={open} onClose={onClose} title="Stored guidance" width="max-w-xl">
      <div className="space-y-5">
        {generationGuide && !hasImpersonate && (
          <TextBlock label={guideLabel(replay?.generationGuideSource)} value={generationGuide} />
        )}

        {hasImpersonate && (
          <section className="space-y-3">
            <h3 className="text-[0.75rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
              /impersonate
            </h3>
            <TextBlock
              label="Current guidance"
              value={impersonateGuidance ?? "No guidance stored"}
              muted={!impersonateGuidance}
            />
            {impersonatePromptTemplate && <TextBlock label="Prompt template" value={impersonatePromptTemplate} />}
            {hasMetadata && (
              <dl className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2">
                {storedText(replay?.impersonatePresetId) && (
                  <MetadataRow label="Preset" value={storedText(replay?.impersonatePresetId)!} />
                )}
                {storedText(replay?.impersonateConnectionId) && (
                  <MetadataRow label="Connection" value={storedText(replay?.impersonateConnectionId)!} />
                )}
                {replay?.impersonateBlockAgents === true && <MetadataRow label="Agents" value="Blocked" />}
              </dl>
            )}
          </section>
        )}

        {!generationGuide && !hasImpersonate && (
          <p className="text-sm text-[var(--muted-foreground)]">No stored guidance on this swipe.</p>
        )}
      </div>
    </Modal>
  );
}
