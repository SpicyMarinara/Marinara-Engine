// ──────────────────────────────────────────────
// Chat Setup Wizard — step-by-step new chat configuration
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  Plug,
  BookOpen,
  Check,
  Plus,
  Search,
  Trash2,
  MessageCircle,
  X,
  Users,
  Loader2,
  Bot,
  Wand2,
  ArrowLeft,
  UserRound,
} from "lucide-react";
import { cn, getAvatarCropStyle, type AvatarCrop } from "../../lib/utils";
import { useConnections } from "../../hooks/use-connections";
import { usePresets, usePresetFull, useDefaultPreset } from "../../hooks/use-presets";
import { useCharacters, usePersonas } from "../../hooks/use-characters";
import { useLorebooks } from "../../hooks/use-lorebooks";
import { useUpdateChat, useUpdateChatMetadata, useCreateMessage, chatKeys } from "../../hooks/use-chats";
import { useChatPresets, useApplyChatPreset } from "../../hooks/use-chat-presets";
import { useUIStore } from "../../stores/ui.store";
import { useChatStore } from "../../stores/chat.store";
import { api } from "../../lib/api-client";
import { getCharacterTitle, parseCharacterDisplayData } from "../../lib/character-display";
import { ChoiceSelectionModal } from "../presets/ChoiceSelectionModal";
import type { Chat, ChatMode, ChatPreset } from "@marinara-engine/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  CHAT_PARAMETER_DEFAULTS,
  GenerationParametersFields,
  getEditableGenerationParameters,
  parseEditableGenerationParameters,
  ROLEPLAY_PARAMETER_DEFAULTS,
  type EditableGenerationParameters,
} from "../ui/GenerationParametersEditor";

// ─── Step definitions ─────────────────────────

interface WizardStep {
  key: string;
  title: string;
  body: string;

  sprite: string;
  spriteFlip?: boolean;
}

const ALL_STEPS: WizardStep[] = [
  {
    key: "connection",
    title: "Choose a Connection",
    body: "Which AI provider should this chat use? If you haven't set one up yet, you can do that from the Connections panel.",
    sprite: "/sprites/mari/Mari_explaining.png",
  },
  {
    key: "preset",
    title: "Pick a Preset",
    body: "Presets control the system prompt structure and generation parameters. The default preset works great for most chats!",
    sprite: "/sprites/mari/Mari_thinking.png",
  },
  {
    key: "persona",
    title: "Select Your Persona",
    body: "Your persona tells the AI who you are. Pick one or skip to stay anonymous.",
    sprite: "/sprites/mari/Mari_greet.png",
  },
  {
    key: "characters",
    title: "Add Characters",
    body: "Characters bring your chat to life! Add one or more characters for the AI to roleplay as.",
    sprite: "/sprites/mari/Mari_point_middle_left.png",
  },
  {
    key: "lorebooks",
    title: "Attach Lorebooks",
    body: "Lorebooks inject world info and lore into the AI's context when relevant keywords appear. Optional but great for rich worlds!",
    sprite: "/sprites/mari/Mari_point_up_left.png",
    spriteFlip: true,
  },
];

// ─── Main component ───────────────────────────

interface ChatSetupWizardProps {
  chat: Chat;
  onFinish: () => void;
}

interface PersonaDisplayInfo {
  id?: string;
  name: string;
  avatarPath?: string | null;
  comment?: string | null;
}

type PersonaSetupOption = PersonaDisplayInfo & {
  id: string;
  avatarPath: string | null;
};

type ConnectionSetupOption = {
  id: string;
  name: string;
  defaultParameters?: unknown;
};

function getPersonaTitle(persona: PersonaDisplayInfo): string | null {
  const title = persona.comment?.trim();
  return title ? title : null;
}

function formatPersonaLabel(persona: PersonaDisplayInfo): string {
  const title = getPersonaTitle(persona);
  return title ? `${persona.name} - ${title}` : persona.name;
}

function getCharacterAvatarCrop(character: { data: unknown }): AvatarCrop | null {
  try {
    const parsed = typeof character.data === "string" ? JSON.parse(character.data) : character.data;
    return (parsed as { extensions?: { avatarCrop?: AvatarCrop | null } } | null)?.extensions?.avatarCrop ?? null;
  } catch {
    return null;
  }
}

function CharacterAvatarImage({
  character,
  src,
  alt,
  className,
}: {
  character: { data: unknown };
  src: string;
  alt: string;
  className: string;
}) {
  return (
    <span className={cn("block shrink-0 overflow-hidden", className)}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover"
        style={getAvatarCropStyle(getCharacterAvatarCrop(character))}
      />
    </span>
  );
}

function PersonaAvatar({ persona }: { persona: PersonaDisplayInfo | null }) {
  if (persona?.avatarPath) {
    return (
      <img src={persona.avatarPath} alt={persona.name} loading="lazy" className="h-7 w-7 rounded-full object-cover" />
    );
  }

  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[0.625rem] font-bold text-[var(--muted-foreground)]">
      {persona?.name ? persona.name[0] : <UserRound size="0.875rem" />}
    </div>
  );
}

function PersonaPicker({
  personas,
  value,
  onChange,
}: {
  personas: PersonaSetupOption[];
  value: string | null;
  onChange: (personaId: string | null) => void;
}) {
  const selectedId = value ?? "";

  return (
    <div className="overflow-hidden rounded-lg bg-[var(--secondary)]/50 ring-1 ring-[var(--border)]">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={!selectedId}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
          !selectedId && "bg-[var(--primary)]/10 ring-1 ring-inset ring-[var(--primary)]/25",
        )}
      >
        <PersonaAvatar persona={null} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">None</span>
          <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">Stay anonymous</span>
        </div>
        {!selectedId && <Check size="0.75rem" className="shrink-0 text-[var(--primary)]" />}
      </button>

      {personas.length > 0 && <div className="border-t border-[var(--border)]" />}

      <div className="max-h-40 overflow-y-auto">
        {personas.map((persona) => {
          const isSelected = selectedId === persona.id;
          const title = getPersonaTitle(persona);
          return (
            <button
              key={persona.id}
              type="button"
              onClick={() => onChange(persona.id)}
              aria-pressed={isSelected}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                isSelected && "bg-[var(--primary)]/10 ring-1 ring-inset ring-[var(--primary)]/25",
              )}
              title={formatPersonaLabel(persona)}
            >
              <PersonaAvatar persona={persona} />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{persona.name}</span>
                {title && (
                  <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">{title}</span>
                )}
              </div>
              {isSelected && <Check size="0.75rem" className="shrink-0 text-[var(--primary)]" />}
            </button>
          );
        })}
        {personas.length === 0 && (
          <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">No personas created yet.</p>
        )}
      </div>
    </div>
  );
}

function SetupGenerationParametersPanel({
  enabled,
  value,
  onEnabledChange,
  onChange,
}: {
  enabled: boolean;
  value: EditableGenerationParameters;
  onEnabledChange: (enabled: boolean) => void;
  onChange: (next: EditableGenerationParameters) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
      <button
        type="button"
        onClick={() => onEnabledChange(!enabled)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <span className="block text-xs font-medium text-[var(--foreground)]">Customize Parameters</span>
          <span className="block text-[0.575rem] text-[var(--muted-foreground)]">
            Leave this off to use the selected connection&apos;s saved defaults for this chat.
          </span>
        </div>
        <div
          className={cn(
            "h-5 w-9 rounded-full p-0.5 transition-colors",
            enabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
          )}
        >
          <div className={cn("h-4 w-4 rounded-full bg-white transition-transform", enabled && "translate-x-3.5")} />
        </div>
      </button>
      {enabled && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <GenerationParametersFields value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export function ChatSetupWizard({ chat, onFinish }: ChatSetupWizardProps) {
  const chatMode = (chat as unknown as { mode?: string }).mode ?? "roleplay";

  if (chatMode === "conversation") {
    return <ConversationQuickSetup chat={chat} onFinish={onFinish} />;
  }

  // Game mode has its own wizard in GameSurface — skip the roleplay wizard
  if (chatMode === "game") {
    return null;
  }

  return <RoleplaySetupWizard chat={chat} onFinish={onFinish} />;
}

// ──────────────────────────────────────────────
// Conversation Quick Setup — Discord-style "New DM" picker
// ──────────────────────────────────────────────

function ConversationQuickSetup({ chat, onFinish }: ChatSetupWizardProps) {
  const { data: connections } = useConnections();
  const { data: allCharacters } = useCharacters();
  const { data: allPersonas } = usePersonas();
  const updateChat = useUpdateChat();
  const updateMeta = useUpdateChatMetadata();
  const openRightPanel = useUIStore((s) => s.openRightPanel);
  const [scheduleState, setScheduleState] = useState<"idle" | "generating" | "done">("idle");
  const [autonomousEnabled, setAutonomousEnabled] = useState(true);
  const [generateSchedule, setGenerateSchedule] = useState(false);

  // Track whether the user has manually edited the chat name.
  // If not, auto-rename to match the selected character name(s).
  const [userEditedName, setUserEditedName] = useState(false);

  // Apply the saved custom conversation prompt immediately so it persists even if the wizard is skipped
  useEffect(() => {
    const savedPrompt = useUIStore.getState().customConversationPrompt;
    if (savedPrompt) {
      updateMeta.mutate({ id: chat.id, customSystemPrompt: savedPrompt });
    }
  }, [chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const characters = useMemo(
    () =>
      (allCharacters ?? []) as Array<{ id: string; data: string; comment?: string | null; avatarPath: string | null }>,
    [allCharacters],
  );
  const personas = (allPersonas ?? []) as Array<{
    id: string;
    name: string;
    avatarPath: string | null;
    comment?: string | null;
  }>;
  const metadata = useMemo(() => {
    const raw = (chat as unknown as { metadata?: string | Record<string, unknown> }).metadata;
    return typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  }, [chat]);
  const connectionOptions = useMemo(() => ((connections ?? []) as ConnectionSetupOption[]) ?? [], [connections]);
  const selectedConnection = useMemo(
    () => connectionOptions.find((connection) => connection.id === chat.connectionId) ?? null,
    [connectionOptions, chat.connectionId],
  );
  const parameterDefaults = useMemo(
    () => getEditableGenerationParameters(CHAT_PARAMETER_DEFAULTS, selectedConnection?.defaultParameters),
    [selectedConnection?.defaultParameters],
  );
  const [customizeParameters, setCustomizeParameters] = useState(
    () => !!parseEditableGenerationParameters(metadata.chatParameters),
  );
  const [generationParameters, setGenerationParameters] = useState<EditableGenerationParameters>(() =>
    getEditableGenerationParameters(parameterDefaults, metadata.chatParameters),
  );

  useEffect(() => {
    setGenerationParameters(getEditableGenerationParameters(parameterDefaults, metadata.chatParameters));
  }, [parameterDefaults, metadata.chatParameters]);

  useEffect(() => {
    setCustomizeParameters(!!parseEditableGenerationParameters(metadata.chatParameters));
  }, [metadata.chatParameters]);

  const chatCharIds: string[] = useMemo(() => {
    return typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : (chat.characterIds ?? []);
  }, [chat.characterIds]);

  const [search, setSearch] = useState("");

  const charInfoMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof parseCharacterDisplayData>>();
    for (const character of characters) {
      map.set(character.id, parseCharacterDisplayData(character));
    }
    return map;
  }, [characters]);

  const getCharacterInfo = useCallback(
    (c: { id?: string; data: string; comment?: string | null }) => {
      if (c.id && charInfoMap.has(c.id)) return charInfoMap.get(c.id)!;
      return parseCharacterDisplayData(c);
    },
    [charInfoMap],
  );

  const charName = useCallback(
    (c: { id?: string; data: string; comment?: string | null }) => getCharacterInfo(c).name,
    [getCharacterInfo],
  );

  // Build an auto-generated chat name from character IDs
  const buildAutoName = useCallback(
    (charIds: string[]) => {
      if (charIds.length === 0) return "New Conversation";
      const names = charIds
        .map((id) => {
          const c = characters.find((ch) => ch.id === id);
          return c ? charName(c) : null;
        })
        .filter((n): n is string => !!n);
      return names.length > 0 ? names.join(", ") : "New Conversation";
    },
    [characters, charName],
  );

  const toggleCharacter = useCallback(
    (charId: string) => {
      const current = [...chatCharIds];
      const idx = current.indexOf(charId);
      if (idx >= 0) current.splice(idx, 1);
      else current.push(charId);

      // Auto-rename the chat if the user hasn't manually edited the name
      if (!userEditedName) {
        const autoName = buildAutoName(current);
        updateChat.mutate({ id: chat.id, characterIds: current, name: autoName });
      } else {
        updateChat.mutate({ id: chat.id, characterIds: current });
      }
    },
    [chat.id, chatCharIds, updateChat, userEditedName, buildAutoName],
  );

  const setConnection = useCallback(
    (connectionId: string | null) => {
      updateChat.mutate({ id: chat.id, connectionId });
    },
    [chat.id, updateChat],
  );

  const setPersona = useCallback(
    (personaId: string | null) => {
      updateChat.mutate({ id: chat.id, personaId });
    },
    [chat.id, updateChat],
  );

  const available = characters.filter((c) => {
    if (chatCharIds.includes(c.id)) return false;
    const info = getCharacterInfo(c);
    const query = search.toLowerCase();
    const title = getCharacterTitle(info)?.toLowerCase() ?? "";
    return info.name.toLowerCase().includes(query) || title.includes(query);
  });

  const hasConnection = !!chat.connectionId;
  const hasCharacters = chatCharIds.length > 0;

  const handleStartChatting = useCallback(async () => {
    if (!hasConnection || !hasCharacters) return;
    // Apply user's saved custom conversation prompt (if any) to this new chat
    const savedPrompt = useUIStore.getState().customConversationPrompt;
    await updateMeta.mutateAsync({
      id: chat.id,
      autonomousMessages: autonomousEnabled,
      conversationSchedulesEnabled: autonomousEnabled && generateSchedule,
      chatParameters: customizeParameters ? generationParameters : null,
      ...(savedPrompt ? { customSystemPrompt: savedPrompt } : {}),
    });
    if (autonomousEnabled && generateSchedule) {
      setScheduleState("generating");
      try {
        const scheduleGenerationPreferences = useUIStore.getState().scheduleGenerationPreferences;
        await api.post("/conversation/schedule/generate", {
          chatId: chat.id,
          characterIds: chatCharIds,
          scheduleGenerationPreferences,
        });
      } catch {
        // Schedule generation is non-critical — continue anyway
      }
      setScheduleState("done");
      setTimeout(onFinish, 2000);
    } else {
      onFinish();
    }
  }, [
    hasConnection,
    hasCharacters,
    chat.id,
    chatCharIds,
    onFinish,
    autonomousEnabled,
    generateSchedule,
    updateMeta,
    customizeParameters,
    generationParameters,
  ]);

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-[3px]" onClick={onFinish} />

      <div className="absolute inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="pointer-events-auto w-full max-w-sm max-h-[90vh] flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageCircle size="0.875rem" className="text-[var(--primary)]" />
              <h3 className="text-sm font-semibold text-[var(--foreground)]">New Conversation</h3>
            </div>
            <button
              onClick={onFinish}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            >
              <X size="0.875rem" />
            </button>
          </div>

          <div className="p-4 space-y-4 overflow-y-auto min-h-0 flex-1">
            {/* Conversation name */}
            <div className="space-y-1.5">
              <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                Name
              </label>
              <input
                type="text"
                key={userEditedName ? "user" : chat.name}
                defaultValue={chat.name}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val && val !== chat.name) {
                    setUserEditedName(true);
                    updateChat.mutate({ id: chat.id, name: val });
                  }
                }}
                placeholder="Conversation name"
                className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-[var(--border)] transition-shadow focus:ring-[var(--primary)]/40 placeholder:text-[var(--muted-foreground)]"
              />
            </div>

            {/* Connection picker */}
            <div className="space-y-1.5">
              <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                Connection
              </label>
              <select
                value={chat.connectionId ?? ""}
                onChange={(e) => setConnection(e.target.value || null)}
                className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-[var(--border)] transition-shadow focus:ring-[var(--primary)]/40"
              >
                <option value="">None</option>
                <option value="random">🎲 Random</option>
                {connectionOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {connectionOptions.length === 0 && (
                <button
                  onClick={() => {
                    openRightPanel("connections");
                    onFinish();
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/20"
                >
                  <Plug size="0.75rem" />
                  Set Up a Connection
                </button>
              )}
              <SetupGenerationParametersPanel
                enabled={customizeParameters}
                value={generationParameters}
                onEnabledChange={setCustomizeParameters}
                onChange={setGenerationParameters}
              />
            </div>

            {/* Persona picker (compact) */}
            <div className="space-y-1.5">
              <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                Your Persona
              </label>
              <PersonaPicker personas={personas} value={chat.personaId ?? null} onChange={setPersona} />
            </div>

            {/* Character picker — main area */}
            <div className="space-y-1.5">
              <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                {chatCharIds.length > 1 ? (
                  <span className="flex items-center gap-1.5">
                    <Users size="0.6875rem" />
                    Group Chat · {chatCharIds.length} members
                  </span>
                ) : (
                  "Who do you want to message?"
                )}
              </label>

              {/* Selected characters */}
              {chatCharIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {chatCharIds.map((cid) => {
                    const c = characters.find((ch) => ch.id === cid);
                    if (!c) return null;
                    const name = charName(c);
                    const title = getCharacterTitle(getCharacterInfo(c));
                    return (
                      <button
                        key={cid}
                        onClick={() => toggleCharacter(cid)}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--primary)]/15 pl-1 pr-2.5 py-1 text-xs ring-1 ring-[var(--primary)]/30 transition-all hover:bg-[var(--destructive)]/15 hover:ring-[var(--destructive)]/30 group"
                        title={title ? `${name} - ${title}` : name}
                      >
                        {c.avatarPath ? (
                          <CharacterAvatarImage
                            character={c}
                            src={c.avatarPath}
                            alt={name}
                            className="h-5 w-5 rounded-full"
                          />
                        ) : (
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5rem] font-bold">
                            {name[0]}
                          </div>
                        )}
                        <span className="truncate max-w-[6rem]">{name}</span>
                        <X
                          size="0.625rem"
                          className="text-[var(--muted-foreground)] group-hover:text-[var(--destructive)]"
                        />
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Search */}
              <div className="rounded-lg ring-1 ring-[var(--border)] bg-[var(--secondary)]/50 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2">
                  <Search size="0.75rem" className="text-[var(--muted-foreground)]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search characters…"
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
                    autoFocus
                  />
                </div>
                <div className="max-h-40 overflow-y-auto border-t border-[var(--border)]">
                  {available.map((c) => {
                    const info = getCharacterInfo(c);
                    const title = getCharacterTitle(info);
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggleCharacter(c.id)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
                      >
                        {c.avatarPath ? (
                          <CharacterAvatarImage
                            character={c}
                            src={c.avatarPath}
                            alt={info.name}
                            className="h-7 w-7 rounded-full"
                          />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                            {info.name[0]}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{info.name}</span>
                          {title && (
                            <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                              {title}
                            </span>
                          )}
                        </div>
                        <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
                      </button>
                    );
                  })}
                  {available.length === 0 && (
                    <p className="px-3 py-3 text-center text-[0.6875rem] text-[var(--muted-foreground)]">
                      {characters.filter((c) => !chatCharIds.includes(c.id)).length === 0
                        ? "All characters added."
                        : "No matches."}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Autonomous messages toggle */}
            <div className="space-y-2">
              <button
                onClick={() => setAutonomousEnabled((v) => !v)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  autonomousEnabled
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Bot
                    size="0.875rem"
                    className={autonomousEnabled ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}
                  />
                  <div>
                    <span className="text-xs font-medium">Autonomous Messages</span>
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      Characters can message you first when you&apos;re inactive
                    </p>
                  </div>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                    autonomousEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      autonomousEnabled && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>

              {/* Generate Schedule sub-toggle */}
              {autonomousEnabled && (
                <button
                  onClick={() => setGenerateSchedule((v) => !v)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                    generateSchedule
                      ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                      : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                  )}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Loader2
                      size="0.875rem"
                      className={generateSchedule ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}
                    />
                    <div>
                      <span className="text-xs font-medium">Generate Schedule</span>
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        Optional routines for availability and delayed replies
                      </p>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      generateSchedule ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        generateSchedule && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-[var(--border)] px-4 py-3">
            {scheduleState === "idle" ? (
              <div className="flex items-center justify-between">
                <button
                  onClick={onFinish}
                  className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                >
                  Skip
                </button>
                <button
                  onClick={handleStartChatting}
                  disabled={!hasConnection || !hasCharacters}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium shadow-sm transition-all active:scale-95",
                    hasConnection && hasCharacters
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90"
                      : "bg-[var(--secondary)] text-[var(--muted-foreground)] cursor-not-allowed opacity-60",
                  )}
                >
                  <MessageCircle size="0.75rem" />
                  Start Chatting
                </button>
              </div>
            ) : scheduleState === "generating" ? (
              <div className="flex items-center justify-center gap-2 py-1">
                <Loader2 size="0.875rem" className="animate-spin text-[var(--primary)]" />
                <span className="text-xs text-[var(--muted-foreground)]">
                  Generating schedule{chatCharIds.length > 1 ? "s" : ""}… hang tight!
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 py-1">
                <Check size="0.875rem" className="text-emerald-400" />
                <span className="text-xs text-emerald-400">Ready! Say hi to start the conversation.</span>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────
// Roleplay Setup Wizard — step-by-step guided setup
// ──────────────────────────────────────────────

function RoleplaySetupWizard({ chat, onFinish }: ChatSetupWizardProps) {
  const STEPS = ALL_STEPS;

  const [step, setStep] = useState(0);
  const currentStep = STEPS[step]!;
  const isLast = step === STEPS.length - 1;
  const [showChoiceModal, setShowChoiceModal] = useState(false);
  // Open in shortcut mode if the chat store flag was set (e.g. via right-click "Quick Start").
  const [shortcutMode, setShortcutMode] = useState(() => {
    const flag = useChatStore.getState().shouldOpenWizardInShortcutMode;
    if (flag) useChatStore.getState().setShouldOpenWizardInShortcutMode(false);
    return flag;
  });
  const [shortcutPresetId, setShortcutPresetId] = useState<string>("");

  const updateChat = useUpdateChat();
  const updateMeta = useUpdateChatMetadata();
  const createMessage = useCreateMessage(chat.id);
  const queryClient = useQueryClient();
  const openRightPanel = useUIStore((s) => s.openRightPanel);

  // Fetch full preset data to check for choice blocks (variables)
  const { data: presetFull, isLoading: presetFullLoading } = usePresetFull(chat.promptPresetId ?? null);

  const { data: connections } = useConnections();
  const { data: presets } = usePresets();
  const { data: defaultPreset } = useDefaultPreset();
  const { data: allPersonas } = usePersonas();
  const { data: allCharacters } = useCharacters();
  const { data: lorebooks } = useLorebooks();

  // Chat-settings presets for the shortcut view
  const chatPresetMode = (
    (chat as unknown as { mode?: string }).mode === "visual_novel" ? "roleplay" : "roleplay"
  ) as ChatMode;
  const { data: chatPresetsData } = useChatPresets(chatPresetMode);
  const chatPresetList = useMemo(() => (chatPresetsData ?? []) as ChatPreset[], [chatPresetsData]);
  const applyChatPreset = useApplyChatPreset();

  const personas = (allPersonas ?? []) as Array<{
    id: string;
    name: string;
    avatarPath: string | null;
    comment?: string | null;
  }>;
  const characters = useMemo(
    () =>
      (allCharacters ?? []) as Array<{ id: string; data: string; comment?: string | null; avatarPath: string | null }>,
    [allCharacters],
  );
  const connectionOptions = useMemo(() => ((connections ?? []) as ConnectionSetupOption[]) ?? [], [connections]);
  const selectedConnection = useMemo(
    () => connectionOptions.find((connection) => connection.id === chat.connectionId) ?? null,
    [connectionOptions, chat.connectionId],
  );
  const parameterDefaults = useMemo(
    () => getEditableGenerationParameters(ROLEPLAY_PARAMETER_DEFAULTS, selectedConnection?.defaultParameters),
    [selectedConnection?.defaultParameters],
  );

  const metadata = useMemo(() => {
    const raw = (chat as unknown as { metadata?: string | Record<string, unknown> }).metadata;
    return typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  }, [chat]);
  const [customizeParameters, setCustomizeParameters] = useState(
    () => !!parseEditableGenerationParameters(metadata.chatParameters),
  );
  const [generationParameters, setGenerationParameters] = useState<EditableGenerationParameters>(() =>
    getEditableGenerationParameters(parameterDefaults, metadata.chatParameters),
  );

  useEffect(() => {
    setGenerationParameters(getEditableGenerationParameters(parameterDefaults, metadata.chatParameters));
  }, [parameterDefaults, metadata.chatParameters]);

  useEffect(() => {
    setCustomizeParameters(!!parseEditableGenerationParameters(metadata.chatParameters));
  }, [metadata.chatParameters]);

  const chatCharIds: string[] = useMemo(() => {
    return typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : (chat.characterIds ?? []);
  }, [chat.characterIds]);

  const activeLorebookIds: string[] = useMemo(() => metadata.activeLorebookIds ?? [], [metadata.activeLorebookIds]);

  // Character name helper
  const charInfoMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof parseCharacterDisplayData>>();
    for (const c of characters) {
      map.set(c.id, parseCharacterDisplayData(c));
    }
    return map;
  }, [characters]);

  const charName = useCallback(
    (c: { id?: string; data: string; comment?: string | null }) => {
      if (c.id && charInfoMap.has(c.id)) return charInfoMap.get(c.id)!.name;
      return parseCharacterDisplayData(c).name;
    },
    [charInfoMap],
  );

  const charTitle = useCallback(
    (c: { id?: string; data: string; comment?: string | null }) => {
      if (c.id && charInfoMap.has(c.id)) return getCharacterTitle(charInfoMap.get(c.id)!);
      return getCharacterTitle(parseCharacterDisplayData(c));
    },
    [charInfoMap],
  );

  // Track whether the user has manually edited the chat name.
  // The roleplay wizard doesn't expose a name field, so this stays false
  // and we always auto-rename based on character selection.
  const [userEditedName] = useState(false);

  // Build an auto-generated chat name from character IDs
  const buildAutoName = useCallback(
    (charIds: string[]) => {
      if (charIds.length === 0) return "New Roleplay";
      const names = charIds.map((id) => charInfoMap.get(id)?.name).filter((n): n is string => !!n);
      return names.length > 0 ? names.join(", ") : "New Roleplay";
    },
    [charInfoMap],
  );

  // ── Mutations ──
  const setConnection = useCallback(
    (connectionId: string | null) => {
      updateChat.mutate({ id: chat.id, connectionId });
    },
    [chat.id, updateChat],
  );

  const setPreset = useCallback(
    (presetId: string | null) => {
      updateChat.mutate({ id: chat.id, promptPresetId: presetId });
    },
    [chat.id, updateChat],
  );

  // Auto-select the default preset for new chats
  useEffect(() => {
    if (!chat.promptPresetId && defaultPreset?.id) {
      updateChat.mutate({ id: chat.id, promptPresetId: defaultPreset.id });
    }
  }, [defaultPreset?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPersona = useCallback(
    (personaId: string | null) => {
      updateChat.mutate({ id: chat.id, personaId });
    },
    [chat.id, updateChat],
  );

  const toggleCharacter = useCallback(
    (charId: string) => {
      const current = [...chatCharIds];
      const idx = current.indexOf(charId);
      if (idx >= 0) {
        current.splice(idx, 1);
        // Auto-rename the chat if the user hasn't manually edited the name
        const updateData: { id: string; characterIds: string[]; name?: string } = {
          id: chat.id,
          characterIds: current,
        };
        if (!userEditedName) updateData.name = buildAutoName(current);
        updateChat.mutate(updateData);
      } else {
        current.push(charId);
        const updateData: { id: string; characterIds: string[]; name?: string } = {
          id: chat.id,
          characterIds: current,
        };
        if (!userEditedName) updateData.name = buildAutoName(current);
        updateChat.mutate(updateData, {
          onSuccess: () => {
            const char = characters.find((c) => c.id === charId);
            if (!char) return;
            try {
              const parsed = typeof char.data === "string" ? JSON.parse(char.data) : char.data;
              const firstMes = (parsed as { first_mes?: string }).first_mes;
              const altGreetings = (parsed as { alternate_greetings?: string[] }).alternate_greetings ?? [];
              if (firstMes) {
                createMessage
                  .mutateAsync({ role: "assistant", content: firstMes, characterId: charId })
                  .then(async (msg) => {
                    if (msg?.id && altGreetings.length > 0) {
                      for (const greeting of altGreetings) {
                        if (greeting.trim()) {
                          await api.post(`/chats/${chat.id}/messages/${msg.id}/swipes`, {
                            content: greeting,
                            silent: true,
                          });
                        }
                      }
                      queryClient.invalidateQueries({ queryKey: chatKeys.messages(chat.id) });
                    }
                  })
                  .catch(() => {});
              }
            } catch {
              /* ignore */
            }
          },
        });
      }
    },
    [chat.id, chatCharIds, characters, createMessage, updateChat, queryClient, userEditedName, buildAutoName],
  );

  const toggleLorebook = useCallback(
    (lbId: string) => {
      const current = [...activeLorebookIds];
      const idx = current.indexOf(lbId);
      if (idx >= 0) current.splice(idx, 1);
      else current.push(lbId);
      updateMeta.mutate({ id: chat.id, activeLorebookIds: current });
    },
    [chat.id, activeLorebookIds, updateMeta],
  );

  // Default the shortcut dropdown once presets load. Prefer (in order):
  //  1) the preset already applied to this chat,
  //  2) the user's starred / active preset for the mode,
  //  3) the built-in Default preset.
  useEffect(() => {
    if (shortcutPresetId) return;
    if (chatPresetList.length === 0) return;
    const appliedId = (metadata.appliedChatPresetId as string | undefined) ?? null;
    const applied = appliedId ? chatPresetList.find((p) => p.id === appliedId) : null;
    const starred = chatPresetList.find((p) => p.isActive);
    const fallback = chatPresetList.find((p) => p.isDefault);
    const pick = applied ?? starred ?? fallback;
    if (pick) setShortcutPresetId(pick.id);
  }, [chatPresetList, shortcutPresetId, metadata.appliedChatPresetId]);

  const [shortcutApplying, setShortcutApplying] = useState(false);

  const finishWizard = useCallback(async () => {
    await updateMeta.mutateAsync({
      id: chat.id,
      chatParameters: customizeParameters ? generationParameters : null,
    });
    onFinish();
  }, [chat.id, customizeParameters, generationParameters, onFinish, updateMeta]);

  const handleShortcutApply = useCallback(async () => {
    if (!shortcutPresetId) {
      onFinish();
      return;
    }
    try {
      setShortcutApplying(true);
      await applyChatPreset.mutateAsync({ presetId: shortcutPresetId, chatId: chat.id });
    } catch {
      /* fall through — still close the wizard */
    } finally {
      setShortcutApplying(false);
      onFinish();
    }
  }, [shortcutPresetId, chat.id, applyChatPreset, onFinish]);

  // Search state for character & lorebook pickers
  const [charSearch, setCharSearch] = useState("");
  const [lbSearch, setLbSearch] = useState("");

  // On the preset step, wait for full preset data before allowing advance
  const isPresetStep = currentStep.key === "preset";
  const nextDisabled = isPresetStep && !!chat.promptPresetId && presetFullLoading;

  const next = useCallback(() => {
    if (isLast) {
      void finishWizard();
    } else {
      // When leaving the preset step (index 1), show the choice modal if the preset has variables
      if (currentStep.key === "preset" && chat.promptPresetId && presetFull?.choiceBlocks?.length) {
        setShowChoiceModal(true);
        return;
      }
      setStep((s) => s + 1);
      setCharSearch("");
      setLbSearch("");
    }
  }, [isLast, finishWizard, currentStep.key, chat.promptPresetId, presetFull?.choiceBlocks?.length]);

  // ─── Step content renderers ───────────────────

  function renderConnection() {
    return (
      <div className="space-y-2">
        <select
          value={chat.connectionId ?? ""}
          onChange={(e) => setConnection(e.target.value || null)}
          className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
        >
          <option value="">None</option>
          <option value="random">🎲 Random</option>
          {connectionOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {connectionOptions.length === 0 && (
          <button
            onClick={() => {
              openRightPanel("connections");
              onFinish();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-2 text-xs font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/20"
          >
            <Plug size="0.8125rem" />
            Set Up a Connection
          </button>
        )}
        <SetupGenerationParametersPanel
          enabled={customizeParameters}
          value={generationParameters}
          onEnabledChange={setCustomizeParameters}
          onChange={setGenerationParameters}
        />
      </div>
    );
  }

  function renderPreset() {
    return (
      <select
        value={chat.promptPresetId ?? ""}
        onChange={(e) => setPreset(e.target.value || null)}
        className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
      >
        <option value="">None</option>
        {((presets ?? []) as Array<{ id: string; name: string; isDefault?: boolean | string }>).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    );
  }

  function renderPersona() {
    return <PersonaPicker personas={personas} value={chat.personaId ?? null} onChange={setPersona} />;
  }

  function renderCharacters() {
    const available = characters.filter((c) => {
      if (chatCharIds.includes(c.id)) return false;
      const query = charSearch.toLowerCase();
      const title = charTitle(c)?.toLowerCase() ?? "";
      return charName(c).toLowerCase().includes(query) || title.includes(query);
    });

    return (
      <div className="space-y-2">
        {/* Added characters */}
        {chatCharIds.length > 0 && (
          <div className="flex flex-col gap-1">
            {chatCharIds.map((cid) => {
              const c = characters.find((ch) => ch.id === cid);
              if (!c) return null;
              const name = charName(c);
              const title = charTitle(c);
              return (
                <div
                  key={cid}
                  className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                >
                  {c.avatarPath ? (
                    <CharacterAvatarImage
                      character={c}
                      src={c.avatarPath}
                      alt={name}
                      className="h-6 w-6 rounded-full"
                    />
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                      {name[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{name}</span>
                    {title && (
                      <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                        {title}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => toggleCharacter(cid)}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                    title="Remove"
                  >
                    <Trash2 size="0.6875rem" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Search + add */}
        <div className="rounded-lg ring-1 ring-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
            <Search size="0.75rem" className="text-[var(--muted-foreground)]" />
            <input
              value={charSearch}
              onChange={(e) => setCharSearch(e.target.value)}
              placeholder="Search characters…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>
          <div className="max-h-32 overflow-y-auto">
            {available.map((c) => {
              const name = charName(c);
              const title = charTitle(c);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCharacter(c.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
                >
                  {c.avatarPath ? (
                    <CharacterAvatarImage
                      character={c}
                      src={c.avatarPath}
                      alt={name}
                      className="h-6 w-6 rounded-full"
                    />
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                      {name[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{name}</span>
                    {title && (
                      <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                        {title}
                      </span>
                    )}
                  </div>
                  <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
                </button>
              );
            })}
            {available.length === 0 && (
              <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                {characters.filter((c) => !chatCharIds.includes(c.id)).length === 0
                  ? "All characters already added."
                  : "No matches."}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderLorebooks() {
    const available = ((lorebooks ?? []) as Array<{ id: string; name: string }>).filter(
      (lb) => !activeLorebookIds.includes(lb.id) && lb.name.toLowerCase().includes(lbSearch.toLowerCase()),
    );

    return (
      <div className="space-y-2">
        {/* Active lorebooks */}
        {activeLorebookIds.length > 0 && (
          <div className="flex flex-col gap-1">
            {activeLorebookIds.map((lbId) => {
              const lb = ((lorebooks ?? []) as Array<{ id: string; name: string }>).find((l) => l.id === lbId);
              if (!lb) return null;
              return (
                <div
                  key={lb.id}
                  className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                >
                  <BookOpen size="0.875rem" className="text-[var(--primary)]" />
                  <span className="flex-1 truncate text-xs">{lb.name}</span>
                  <button
                    onClick={() => toggleLorebook(lb.id)}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                    title="Remove"
                  >
                    <Trash2 size="0.6875rem" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Search + add */}
        <div className="rounded-lg ring-1 ring-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
            <Search size="0.75rem" className="text-[var(--muted-foreground)]" />
            <input
              value={lbSearch}
              onChange={(e) => setLbSearch(e.target.value)}
              placeholder="Search lorebooks…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>
          <div className="max-h-32 overflow-y-auto">
            {available.map((lb) => (
              <button
                key={lb.id}
                onClick={() => toggleLorebook(lb.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
              >
                <BookOpen size="0.875rem" className="text-[var(--muted-foreground)]" />
                <span className="flex-1 truncate text-xs">{lb.name}</span>
                <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
              </button>
            ))}
            {available.length === 0 && (
              <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                {((lorebooks ?? []) as Array<{ id: string }>).filter((lb) => !activeLorebookIds.includes(lb.id))
                  .length === 0
                  ? "All lorebooks already added."
                  : "No matches."}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const stepRenderers: Record<string, () => React.ReactNode> = {
    connection: renderConnection,
    preset: renderPreset,
    persona: renderPersona,
    characters: renderCharacters,
    lorebooks: renderLorebooks,
  };

  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-[3px]" onClick={onFinish} />

      {/* Preset variable selection modal */}
      <ChoiceSelectionModal
        open={showChoiceModal}
        onClose={() => {
          setShowChoiceModal(false);
          setStep((s) => s + 1);
          setCharSearch("");
          setLbSearch("");
        }}
        presetId={chat.promptPresetId ?? null}
        chatId={chat.id}
      />

      {/* Wizard card — centered (hidden while choice modal is open) */}
      <div
        className={cn(
          "absolute inset-0 z-50 flex items-center justify-center p-4 pointer-events-none",
          showChoiceModal && "hidden",
        )}
      >
        <AnimatePresence mode="wait">
          {shortcutMode ? (
            <motion.div
              key="shortcut"
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="pointer-events-auto w-full max-w-sm max-h-[90vh] flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <button
                  onClick={() => setShortcutMode(false)}
                  className="flex items-center gap-1.5 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                  aria-label="Back"
                >
                  <ArrowLeft size="0.875rem" />
                </button>
                <div className="flex items-center gap-1.5">
                  <Wand2 size="0.875rem" className="text-[var(--primary)]" />
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Quick Setup</h3>
                </div>
                <button
                  onClick={onFinish}
                  className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                  aria-label="Close"
                >
                  <X size="0.875rem" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                <p className="text-center text-xs leading-relaxed text-[var(--muted-foreground)]">
                  Pick a preset, your persona, and any characters to instantly configure this roleplay.
                </p>

                {/* Chat Preset */}
                <div className="space-y-1.5">
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Chat Preset
                  </label>
                  <select
                    value={shortcutPresetId}
                    onChange={(e) => setShortcutPresetId(e.target.value)}
                    className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-[var(--border)] transition-shadow focus:ring-[var(--primary)]/40"
                  >
                    {chatPresetList.length === 0 && <option value="">Loading…</option>}
                    {chatPresetList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.isDefault ? "Default" : p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Persona */}
                <div className="space-y-1.5">
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Persona
                  </label>
                  <PersonaPicker personas={personas} value={chat.personaId ?? null} onChange={setPersona} />
                </div>

                {/* Characters */}
                <div className="space-y-1.5">
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    {chatCharIds.length > 1 ? (
                      <span className="flex items-center gap-1.5">
                        <Users size="0.6875rem" />
                        Characters · {chatCharIds.length}
                      </span>
                    ) : (
                      "Characters"
                    )}
                  </label>

                  {chatCharIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {chatCharIds.map((cid) => {
                        const c = characters.find((ch) => ch.id === cid);
                        if (!c) return null;
                        const name = charName(c);
                        const title = charTitle(c);
                        return (
                          <button
                            key={cid}
                            onClick={() => toggleCharacter(cid)}
                            className="flex items-center gap-1.5 rounded-full bg-[var(--primary)]/15 pl-1 pr-2.5 py-1 text-xs ring-1 ring-[var(--primary)]/30 transition-all hover:bg-[var(--destructive)]/15 hover:ring-[var(--destructive)]/30 group"
                            title={title ? `${name} - ${title}` : name}
                          >
                            {c.avatarPath ? (
                              <CharacterAvatarImage
                                character={c}
                                src={c.avatarPath}
                                alt={name}
                                className="h-5 w-5 rounded-full"
                              />
                            ) : (
                              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5rem] font-bold">
                                {name[0]}
                              </div>
                            )}
                            <span className="truncate max-w-[6rem]">{name}</span>
                            <X
                              size="0.625rem"
                              className="text-[var(--muted-foreground)] group-hover:text-[var(--destructive)]"
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="rounded-lg ring-1 ring-[var(--border)] bg-[var(--card)] overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                      <Search size="0.75rem" className="text-[var(--muted-foreground)]" />
                      <input
                        value={charSearch}
                        onChange={(e) => setCharSearch(e.target.value)}
                        placeholder="Search characters…"
                        className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {characters
                        .filter((c) => {
                          if (chatCharIds.includes(c.id)) return false;
                          const query = charSearch.toLowerCase();
                          const title = charTitle(c)?.toLowerCase() ?? "";
                          return charName(c).toLowerCase().includes(query) || title.includes(query);
                        })
                        .map((c) => {
                          const name = charName(c);
                          const title = charTitle(c);
                          return (
                            <button
                              key={c.id}
                              onClick={() => toggleCharacter(c.id)}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
                            >
                              {c.avatarPath ? (
                                <CharacterAvatarImage
                                  character={c}
                                  src={c.avatarPath}
                                  alt={name}
                                  className="h-6 w-6 rounded-full"
                                />
                              ) : (
                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                                  {name[0]}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-xs">{name}</span>
                                {title && (
                                  <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                                    {title}
                                  </span>
                                )}
                              </div>
                              <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
                            </button>
                          );
                        })}
                      {characters.filter((c) => {
                        if (chatCharIds.includes(c.id)) return false;
                        const query = charSearch.toLowerCase();
                        const title = charTitle(c)?.toLowerCase() ?? "";
                        return charName(c).toLowerCase().includes(query) || title.includes(query);
                      }).length === 0 && (
                        <p className="px-3 py-3 text-center text-[0.6875rem] text-[var(--muted-foreground)]">
                          {characters.filter((c) => !chatCharIds.includes(c.id)).length === 0
                            ? "All characters added."
                            : "No matches."}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-[var(--border)] px-4 py-3 flex items-center justify-between">
                <button
                  onClick={() => setShortcutMode(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                >
                  Back
                </button>
                <button
                  onClick={handleShortcutApply}
                  disabled={shortcutApplying || !shortcutPresetId}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-1.5 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
                >
                  {shortcutApplying ? (
                    <>
                      <Loader2 size="0.75rem" className="animate-spin" />
                      Applying…
                    </>
                  ) : (
                    <>
                      <Wand2 size="0.75rem" />
                      Apply &amp; Start
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="pointer-events-auto w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
            >
              {/* Sprite */}
              <div className="mb-3 flex justify-center">
                <img
                  src={currentStep.sprite}
                  alt="Professor Mari"
                  className="h-28 w-auto object-contain drop-shadow-lg"
                  style={currentStep.spriteFlip ? { transform: "scaleX(-1)" } : undefined}
                  draggable={false}
                />
              </div>

              {/* Title */}
              <h3 className="mb-1 text-center text-sm font-semibold text-[var(--foreground)]">{currentStep.title}</h3>

              {/* Body */}
              <p className="mb-4 text-center text-xs leading-relaxed text-[var(--muted-foreground)]">
                {currentStep.body}
              </p>

              {/* Step content */}
              <div className="mb-4">{stepRenderers[currentStep.key]?.()}</div>

              {/* Progress dots */}
              <div className="mb-3 flex items-center justify-center gap-1.5">
                {STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-300",
                      i === step
                        ? "w-4 bg-[var(--primary)]"
                        : i < step
                          ? "w-1.5 bg-[var(--primary)]/40"
                          : "w-1.5 bg-[var(--muted-foreground)]/20",
                    )}
                  />
                ))}
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={onFinish}
                  className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                >
                  Skip
                </button>
                <button
                  onClick={() => setShortcutMode(true)}
                  title="Apply a saved chat-settings preset and pick a persona + characters in one step"
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/20"
                >
                  <Wand2 size="0.75rem" />
                  <span className="hidden xs:inline sm:inline">Use Settings Presets</span>
                  <span className="inline xs:hidden sm:hidden">Presets</span>
                </button>
                <button
                  onClick={next}
                  disabled={nextDisabled}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-1.5 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
                >
                  {isLast ? "Done" : "Next"}
                  {isLast ? <Check size="0.75rem" /> : <ChevronRight size="0.75rem" />}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
