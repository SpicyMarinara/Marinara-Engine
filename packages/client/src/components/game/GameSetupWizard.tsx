// ──────────────────────────────────────────────
// Game: Setup Wizard (initial game setup modal)
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Wand2,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Search,
  Plus,
  X,
  Sparkles,
  User,
  Plug,
  Image,
  BookOpen,
  Music2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { GameSetupConfig, GameGmMode } from "@marinara-engine/shared";
import { getCharacterTitle } from "../../lib/character-display";
import { api } from "../../lib/api-client";
import { cn, getAvatarCropStyle, parseAvatarCropJson, type AvatarCropValue } from "../../lib/utils";
import { Modal } from "../ui/Modal";
import {
  GenerationParametersFields,
  getEditableGenerationParameters,
  ROLEPLAY_PARAMETER_DEFAULTS,
  type EditableGenerationParameters,
} from "../ui/GenerationParametersEditor";
import { useConnections } from "../../hooks/use-connections";
import { usePersonas } from "../../hooks/use-characters";
import { useSidecarStore } from "../../stores/sidecar.store";
import { useLorebooks } from "../../hooks/use-lorebooks";
import { useGameAssetStore } from "../../stores/game-asset.store";
import { useUIStore } from "../../stores/ui.store";

interface GameSetupWizardProps {
  onComplete: (
    config: GameSetupConfig,
    preferences: string,
    connections: { gmConnectionId?: string },
    gameName?: string,
  ) => void;
  onCancel: () => void;
  isLoading: boolean;
  characters: Array<{
    id: string;
    name: string;
    comment?: string | null;
    avatarUrl?: string | null;
    avatarCrop?: AvatarCropValue | null;
  }>;
}

interface PersonaDisplayInfo {
  name: string;
  comment?: string | null;
}

function CharacterAvatar({
  character,
  className = "h-6 w-6 rounded-full",
}: {
  character: {
    name: string;
    avatarUrl?: string | null;
    avatarCrop?: AvatarCropValue | null;
  };
  className?: string;
}) {
  if (!character.avatarUrl) {
    return (
      <div className={cn("flex items-center justify-center bg-[var(--accent)] text-[0.5625rem] font-bold", className)}>
        {character.name[0]}
      </div>
    );
  }
  return (
    <span className={cn("relative block shrink-0 overflow-hidden", className)}>
      <img
        src={character.avatarUrl}
        alt={character.name}
        loading="lazy"
        className="h-full w-full object-cover"
        style={getAvatarCropStyle(character.avatarCrop)}
      />
    </span>
  );
}

function getPersonaTitle(persona: PersonaDisplayInfo): string | null {
  const title = persona.comment?.trim();
  return title ? title : null;
}

const GENRES = ["Fantasy", "Sci-Fi", "Horror", "Modern", "Post-Apocalyptic", "Cyberpunk", "Steampunk", "Historical"];
const TONES = ["Heroic", "Dark", "Comedic", "Gritty", "Whimsical", "Serious", "Campy"];
const DIFFICULTIES = ["Casual", "Normal", "Hard", "Brutal"];
const LEARNED_OPTION_PREVIEW_LIMIT = 8;

const SETTING_SUGGESTIONS = [
  "Surprise me!",
  "A war-torn kingdom with ancient ruins",
  "A neon-lit city of hackers and megacorps",
  "A cursed forest hiding a forgotten god",
];

const GOAL_SUGGESTIONS = [
  "Surprise me!",
  "Find the lost artifact",
  "Survive and uncover the truth",
  "Become the ruler of the land",
];

const PREFERENCE_SUGGESTIONS = [
  "Include romance subplot",
  "Focus on exploration",
  "Make NPCs memorable",
  "Keep it short",
];

type GameSpotifySourceType = "liked" | "playlist" | "artist" | "any";

const GAME_SPOTIFY_SOURCE_OPTIONS: Array<{ id: GameSpotifySourceType; label: string; description: string }> = [
  { id: "liked", label: "Liked Songs", description: "Pick from saved tracks first." },
  { id: "playlist", label: "Playlist", description: "Keep choices inside one Spotify playlist." },
  { id: "artist", label: "Artist", description: "Search only around a named artist, like HOYO-MiX." },
  { id: "any", label: "Any Spotify", description: "Let the DJ use Spotify search when it fits." },
];

function normalizeGameSpotifySourceType(value: unknown): GameSpotifySourceType {
  return value === "playlist" || value === "artist" || value === "any" ? value : "liked";
}

type LearnedOptionGroup = "genres" | "tones" | "settings" | "goals" | "preferences";

function optionKey(value: string) {
  return value.trim().toLowerCase();
}

function filterLearnedOptions(options: string[] | undefined, excluded: string[]) {
  const excludedKeys = new Set(excluded.map(optionKey));
  const seen = new Set<string>();
  return (options ?? []).filter((option) => {
    const trimmed = option.trim();
    const key = optionKey(trimmed);
    if (!trimmed || excludedKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterCustomLearnedValues(values: string[], builtIns: string[]) {
  const excluded = new Set([...builtIns, "Surprise me, go wild!"].map(optionKey));
  return values.map((value) => value.trim()).filter((value) => value && !excluded.has(optionKey(value)));
}

function LearnedOptionChips({
  options,
  expanded,
  onToggleExpanded,
  onSelect,
  onForget,
  selected,
}: {
  options: string[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onSelect: (value: string) => void;
  onForget?: (value: string) => void;
  selected?: (value: string) => boolean;
}) {
  if (options.length === 0) return null;

  const visible = expanded ? options : options.slice(0, LEARNED_OPTION_PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, options.length - visible.length);

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {visible.map((option) => {
        const isSelected = selected?.(option) ?? false;
        return (
          <span
            key={option}
            className={cn(
              "group/learned inline-flex items-center rounded-full text-[0.625rem] transition-colors",
              isSelected
                ? "bg-[var(--primary)]/20 text-[var(--primary)] ring-1 ring-[var(--primary)]/35"
                : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--primary)]/10 hover:text-[var(--primary)]",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(option)}
              className="px-2 py-0.5"
            >
              {option}
            </button>
            {onForget && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onForget(option);
                }}
                aria-label={`Forget ${option}`}
                title="Forget this option"
                className="ml-0.5 mr-1 inline-flex rounded-full p-0.5 opacity-40 transition-opacity hover:bg-[var(--destructive)]/20 hover:text-[var(--destructive)] hover:opacity-100 focus-visible:opacity-100 group-hover/learned:opacity-100"
              >
                <X size={9} />
              </button>
            )}
          </span>
        );
      })}
      {(hiddenCount > 0 || expanded) && (
        <button
          type="button"
          onClick={onToggleExpanded}
          className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
        >
          {expanded ? "Show less" : `+${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

type GameLanguageOption = {
  label: string;
  value: string;
  aliases?: string[];
};

const GAME_LANGUAGE_OPTIONS: readonly GameLanguageOption[] = [
  { label: "English", value: "English" },
  { label: "日本語", value: "Japanese" },
  { label: "한국어", value: "Korean" },
  { label: "中文", value: "Chinese" },
  { label: "Español", value: "Spanish", aliases: ["Espanol"] },
  { label: "Français", value: "French", aliases: ["Francais"] },
  { label: "Deutsch", value: "German" },
  { label: "Polski", value: "Polish" },
  { label: "Português", value: "Portuguese", aliases: ["Portugues"] },
  { label: "Русский", value: "Russian" },
];

const GAME_LANGUAGE_LOOKUP = new Map(
  GAME_LANGUAGE_OPTIONS.flatMap((option) => {
    const entries: Array<[string, string]> = [
      [option.label.toLowerCase(), option.value],
      [option.value.toLowerCase(), option.value],
    ];
    for (const alias of option.aliases ?? []) {
      entries.push([alias.toLowerCase(), option.value]);
    }
    return entries;
  }),
);

function normalizeGameLanguage(language: string): string {
  const trimmed = language.trim();
  if (!trimmed) return "";
  return GAME_LANGUAGE_LOOKUP.get(trimmed.toLowerCase()) ?? trimmed;
}

export function GameSetupWizard({ onComplete, onCancel, isLoading, characters }: GameSetupWizardProps) {
  const [step, setStep] = useState(0);
  const [gameName, setGameName] = useState("");
  const [genres, setGenres] = useState<string[]>(["Fantasy"]);
  const [customGenre, setCustomGenre] = useState("");
  const [setting, setSetting] = useState("");
  const [tones, setTones] = useState<string[]>(["Heroic"]);
  const [customTone, setCustomTone] = useState("");
  const [difficulty, setDifficulty] = useState("Normal");
  const [gmMode, setGmMode] = useState<GameGmMode>("standalone");
  const [gmCharacterId, setGmCharacterId] = useState<string | null>(null);
  const [partyCharacterIds, setPartyCharacterIds] = useState<string[]>([]);
  const [playerGoals, setPlayerGoals] = useState(
    () => useUIStore.getState().rememberedGameSetupText?.playerGoals ?? "",
  );
  const [preferences, setPreferences] = useState(
    () => useUIStore.getState().rememberedGameSetupText?.preferences ?? "",
  );
  const [gmSearch, setGmSearch] = useState("");
  const [partySearch, setPartySearch] = useState("");
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [gmConnectionId, setGmConnectionId] = useState<string | null>(null);
  const [customizeParameters, setCustomizeParameters] = useState(false);
  const [generationParameters, setGenerationParameters] =
    useState<EditableGenerationParameters>(ROLEPLAY_PARAMETER_DEFAULTS);
  const [personaSearch, setPersonaSearch] = useState("");
  const [rating, setRating] = useState<"sfw" | "nsfw">("sfw");
  const [useLocalScene, setUseLocalScene] = useState(true);
  const [enableSpriteGeneration, setEnableSpriteGeneration] = useState(false);
  const [enableSpotifyDj, setEnableSpotifyDj] = useState(false);
  const [gameSpotifySourceType, setGameSpotifySourceType] = useState<GameSpotifySourceType>("liked");
  const [gameSpotifyPlaylistId, setGameSpotifyPlaylistId] = useState("");
  const [gameSpotifyPlaylistName, setGameSpotifyPlaylistName] = useState("");
  const [gameSpotifyArtist, setGameSpotifyArtist] = useState("");
  const [enableLorebookKeeper, setEnableLorebookKeeper] = useState(false);
  const [imageConnectionId, setImageConnectionId] = useState<string | null>(null);
  const [sceneConnectionId, setSceneConnectionId] = useState<string | null>(null);
  const [activeLorebookIds, setActiveLorebookIds] = useState<string[]>([]);
  const [lbSearch, setLbSearch] = useState("");
  const [enableCustomWidgets, setEnableCustomWidgets] = useState(true);
  const [language, setLanguage] = useState("English");
  const [startMuted, setStartMuted] = useState(false);
  const [expandedLearnedOptions, setExpandedLearnedOptions] = useState<Record<LearnedOptionGroup, boolean>>({
    genres: false,
    tones: false,
    settings: false,
    goals: false,
    preferences: false,
  });

  const sidecarStatus = useSidecarStore((s) => s.status);
  const sidecarConfig = useSidecarStore((s) => s.config);
  const learnedGameSetupOptions = useUIStore((s) => s.learnedGameSetupOptions);
  const rememberGameSetupOptions = useUIStore((s) => s.rememberGameSetupOptions);
  const forgetGameSetupOption = useUIStore((s) => s.forgetGameSetupOption);
  const sidecarAvailable = !!sidecarConfig.modelPath && sidecarStatus !== "not_downloaded";

  // Fetch sidecar status on mount so the dropdown is populated without visiting Connections first
  useEffect(() => {
    useSidecarStore.getState().fetchStatus();
  }, []);

  // Once status loads, sync the local toggle with the persisted config
  useEffect(() => {
    if (sidecarAvailable) {
      setUseLocalScene(sidecarConfig.useForGameScene);
    }
  }, [sidecarAvailable, sidecarConfig.useForGameScene]);

  // "local" = sidecar, a connection id = API connection, null = skip
  const sceneModelValue = useLocalScene && sidecarAvailable ? "local" : sceneConnectionId;

  const { data: connectionsList } = useConnections();
  const { data: personasList } = usePersonas();
  const { data: lorebooksList } = useLorebooks();
  const spotifyPlaylistsQuery = useQuery({
    queryKey: ["spotify", "playlists", 50],
    queryFn: () =>
      api.get<{
        playlists: Array<{
          id: string;
          name: string;
          uri: string;
          trackCount: number | null;
          owned: boolean | null;
        }>;
      }>("/spotify/playlists?limit=50"),
    enabled: enableSpotifyDj && gameSpotifySourceType === "playlist",
    staleTime: 60_000,
    retry: false,
  });

  const connections = useMemo(
    () =>
      (connectionsList as Array<{
        id: string;
        name: string;
        model?: string;
        provider?: string;
        defaultParameters?: string | null;
      }>) ?? [],
    [connectionsList],
  );
  const selectedGmConnection = useMemo(
    () => connections.find((connection) => connection.id === gmConnectionId) ?? null,
    [connections, gmConnectionId],
  );
  const gmParameterDefaults = useMemo(
    () => getEditableGenerationParameters(ROLEPLAY_PARAMETER_DEFAULTS, selectedGmConnection?.defaultParameters),
    [selectedGmConnection?.defaultParameters],
  );
  const imageConnections = useMemo(() => connections.filter((c) => c.provider === "image_generation"), [connections]);
  const personas = useMemo(
    () =>
      (personasList as Array<{
        id: string;
        name: string;
        avatarPath?: string | null;
        avatarCrop?: string | null;
        comment?: string;
      }>) ?? [],
    [personasList],
  );

  const lorebooks = useMemo(
    () => (lorebooksList as Array<{ id: string; name: string; enabled?: boolean }>) ?? [],
    [lorebooksList],
  );

  const availableLorebooks = useMemo(
    () =>
      lorebooks
        .filter((lb) => !activeLorebookIds.includes(lb.id))
        .filter((lb) => lb.name.toLowerCase().includes(lbSearch.toLowerCase())),
    [lorebooks, activeLorebookIds, lbSearch],
  );

  const toggleLorebook = useCallback((lbId: string) => {
    setActiveLorebookIds((prev) => (prev.includes(lbId) ? prev.filter((id) => id !== lbId) : [...prev, lbId]));
  }, []);

  const filteredPersonas = useMemo(
    () =>
      personas.filter((p) => {
        const query = personaSearch.toLowerCase();
        const title = getPersonaTitle(p)?.toLowerCase() ?? "";
        return p.name.toLowerCase().includes(query) || title.includes(query);
      }),
    [personas, personaSearch],
  );

  const steps = ["Genre & Setting", "Party & GM", "You & Model", "Goals"];
  const learnedGenres = useMemo(
    () => filterLearnedOptions(learnedGameSetupOptions?.genres, [...GENRES, ...genres]),
    [genres, learnedGameSetupOptions?.genres],
  );
  const learnedTones = useMemo(
    () => filterLearnedOptions(learnedGameSetupOptions?.tones, [...TONES, ...tones]),
    [learnedGameSetupOptions?.tones, tones],
  );
  const learnedSettings = useMemo(
    () => filterLearnedOptions(learnedGameSetupOptions?.settings, [...SETTING_SUGGESTIONS, setting]),
    [learnedGameSetupOptions?.settings, setting],
  );
  const learnedGoals = useMemo(
    () => filterLearnedOptions(learnedGameSetupOptions?.goals, [...GOAL_SUGGESTIONS, playerGoals]),
    [learnedGameSetupOptions?.goals, playerGoals],
  );
  const learnedPreferences = useMemo(
    () => filterLearnedOptions(learnedGameSetupOptions?.preferences, [...PREFERENCE_SUGGESTIONS, preferences]),
    [learnedGameSetupOptions?.preferences, preferences],
  );

  const toggleLearnedOptions = (group: LearnedOptionGroup) => {
    setExpandedLearnedOptions((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const toggleGenre = (g: string) => {
    setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  };

  const addCustomGenre = () => {
    const trimmed = customGenre.trim();
    if (trimmed && !genres.includes(trimmed)) {
      setGenres((prev) => [...prev, trimmed]);
    }
    setCustomGenre("");
  };

  const toggleTone = (t: string) => {
    setTones((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const addCustomTone = () => {
    const trimmed = customTone.trim();
    if (trimmed && !tones.includes(trimmed)) {
      setTones((prev) => [...prev, trimmed]);
    }
    setCustomTone("");
  };

  const togglePartyMember = (id: string) => {
    setPartyCharacterIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  const filteredGmCharacters = useMemo(
    () =>
      characters.filter((c) => {
        const query = gmSearch.toLowerCase();
        const title = getCharacterTitle(c)?.toLowerCase() ?? "";
        return c.name.toLowerCase().includes(query) || title.includes(query);
      }),
    [characters, gmSearch],
  );

  const filteredPartyCharacters = useMemo(
    () =>
      characters.filter((c) => {
        if (c.id === gmCharacterId) return false;
        const query = partySearch.toLowerCase();
        const title = getCharacterTitle(c)?.toLowerCase() ?? "";
        return c.name.toLowerCase().includes(query) || title.includes(query);
      }),
    [characters, gmCharacterId, partySearch],
  );

  const applySuggestion = useCallback((setter: (v: string) => void, value: string) => {
    if (value === "Surprise me!") {
      setter("Surprise me, go wild!");
    } else {
      setter(value);
    }
  }, []);

  useEffect(() => {
    setGenerationParameters(gmParameterDefaults);
  }, [gmParameterDefaults]);

  const canStart = !!gmConnectionId;
  const normalizedLanguage = normalizeGameLanguage(language);

  const handleComplete = () => {
    if (isLoading || !canStart) return;
    if (startMuted) {
      useGameAssetStore.getState().setAudioMuted(true);
    }
    // Sync the wizard's local-scene toggle to the global sidecar config
    if (sidecarAvailable) {
      useSidecarStore.getState().updateConfig({ useForGameScene: sceneModelValue === "local" });
    }
    rememberGameSetupOptions(
      {
        genres: filterCustomLearnedValues(genres, GENRES),
        tones: filterCustomLearnedValues(tones, TONES),
        settings: filterCustomLearnedValues(setting ? [setting] : [], SETTING_SUGGESTIONS),
        goals: filterCustomLearnedValues(playerGoals ? [playerGoals] : [], GOAL_SUGGESTIONS),
        preferences: filterCustomLearnedValues(preferences ? [preferences] : [], PREFERENCE_SUGGESTIONS),
      },
      {
        playerGoals,
        preferences,
      },
    );
    onComplete(
      {
        genre: genres.join(", ") || "Fantasy",
        setting: setting || `A ${(genres[0] ?? "fantasy").toLowerCase()} world`,
        tone: tones.join(", ") || "Heroic",
        difficulty,
        rating,
        gmMode,
        gmCharacterId: gmMode === "character" && gmCharacterId ? gmCharacterId : undefined,
        partyCharacterIds,
        playerGoals: playerGoals || "Have an adventure",
        personaId: personaId ?? undefined,
        sceneConnectionId: sceneModelValue && sceneModelValue !== "local" ? sceneModelValue : undefined,
        enableSpriteGeneration: enableSpriteGeneration || undefined,
        imageConnectionId: enableSpriteGeneration && imageConnectionId ? imageConnectionId : undefined,
        activeLorebookIds: activeLorebookIds.length > 0 ? activeLorebookIds : undefined,
        enableCustomWidgets,
        enableSpotifyDj: enableSpotifyDj || undefined,
        spotifySourceType: enableSpotifyDj ? gameSpotifySourceType : undefined,
        spotifyPlaylistId:
          enableSpotifyDj && gameSpotifySourceType === "playlist"
            ? gameSpotifyPlaylistId.trim() || undefined
            : undefined,
        spotifyPlaylistName:
          enableSpotifyDj && gameSpotifySourceType === "playlist"
            ? gameSpotifyPlaylistName.trim() || undefined
            : undefined,
        spotifyArtist:
          enableSpotifyDj && gameSpotifySourceType === "artist" ? gameSpotifyArtist.trim() || undefined : undefined,
        enableLorebookKeeper: enableLorebookKeeper || undefined,
        language: normalizedLanguage || undefined,
        generationParameters: customizeParameters ? generationParameters : undefined,
      },
      preferences,
      {
        gmConnectionId: gmConnectionId ?? undefined,
      },
      gameName.trim() || undefined,
    );
  };

  return (
    <Modal open={true} onClose={onCancel} title="New Game Setup" width="max-w-lg">
      {/* Step indicator */}
      <div className="mb-5 flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => i < step && setStep(i)}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors",
                i <= step ? "bg-[var(--primary)] text-white" : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
                i < step && "cursor-pointer hover:opacity-80",
              )}
            >
              {i + 1}
            </button>
            <span className={cn("text-xs", i <= step ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]")}>
              {s}
            </span>
            {i < steps.length - 1 && <div className="h-px w-4 bg-[var(--border)]" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="mb-5 space-y-4">
        {step === 0 && (
          <>
            {/* Game Name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Game Name</label>
              <input
                type="text"
                value={gameName}
                onChange={(e) => setGameName(e.target.value)}
                placeholder="Name your adventure…"
                className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none ring-1 ring-transparent transition-all placeholder:text-[var(--muted-foreground)] focus:ring-[var(--primary)]/40"
              />
            </div>

            {/* Genre — multi-select */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
                Genre ({genres.length} selected)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {GENRES.map((g) => (
                  <button
                    key={g}
                    onClick={() => toggleGenre(g)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs transition-colors",
                      genres.includes(g)
                        ? "bg-[var(--primary)]/20 text-[var(--primary)] ring-1 ring-[var(--primary)]/40"
                        : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                    )}
                  >
                    {g}
                  </button>
                ))}
                {/* Custom genres */}
                {genres
                  .filter((g) => !GENRES.includes(g))
                  .map((g) => (
                    <button
                      key={g}
                      onClick={() => toggleGenre(g)}
                      className="flex items-center gap-1 rounded-full bg-[var(--primary)]/20 px-3 py-1 text-xs text-[var(--primary)] ring-1 ring-[var(--primary)]/40 transition-colors"
                    >
                      {g}
                      <X size={10} />
                    </button>
                  ))}
              </div>
              <LearnedOptionChips
                options={learnedGenres}
                expanded={expandedLearnedOptions.genres}
                onToggleExpanded={() => toggleLearnedOptions("genres")}
                onSelect={toggleGenre}
                onForget={(value) => forgetGameSetupOption("genres", value)}
                selected={(value) => genres.includes(value)}
              />
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  type="text"
                  value={customGenre}
                  onChange={(e) => setCustomGenre(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustomGenre()}
                  placeholder="Add custom genre…"
                  className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-xs text-[var(--foreground)] outline-none ring-1 ring-transparent transition-all placeholder:text-[var(--muted-foreground)] focus:ring-[var(--primary)]/40"
                />
                <button
                  onClick={addCustomGenre}
                  disabled={!customGenre.trim()}
                  className="rounded-lg bg-[var(--secondary)] p-1.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)] disabled:opacity-40"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {/* Setting */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Setting</label>
              <input
                type="text"
                value={setting}
                onChange={(e) => setSetting(e.target.value)}
                placeholder="Describe your world…"
                className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none ring-1 ring-transparent transition-all placeholder:text-[var(--muted-foreground)] focus:ring-[var(--primary)]/40"
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {SETTING_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => applySuggestion(setSetting, s)}
                    className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)] hover:bg-[var(--primary)]/10"
                  >
                    {s === "Surprise me!" && <Sparkles size={9} />}
                    {s}
                  </button>
                ))}
              </div>
              <LearnedOptionChips
                options={learnedSettings}
                expanded={expandedLearnedOptions.settings}
                onToggleExpanded={() => toggleLearnedOptions("settings")}
                onSelect={setSetting}
                onForget={(value) => forgetGameSetupOption("settings", value)}
              />
            </div>

            {/* Tone — multi-select */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
                Tone ({tones.length} selected)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {TONES.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleTone(t)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs transition-colors",
                      tones.includes(t)
                        ? "bg-[var(--primary)]/20 text-[var(--primary)] ring-1 ring-[var(--primary)]/40"
                        : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                    )}
                  >
                    {t}
                  </button>
                ))}
                {/* Custom tones */}
                {tones
                  .filter((t) => !TONES.includes(t))
                  .map((t) => (
                    <button
                      key={t}
                      onClick={() => toggleTone(t)}
                      className="flex items-center gap-1 rounded-full bg-[var(--primary)]/20 px-3 py-1 text-xs text-[var(--primary)] ring-1 ring-[var(--primary)]/40 transition-colors"
                    >
                      {t}
                      <X size={10} />
                    </button>
                  ))}
              </div>
              <LearnedOptionChips
                options={learnedTones}
                expanded={expandedLearnedOptions.tones}
                onToggleExpanded={() => toggleLearnedOptions("tones")}
                onSelect={toggleTone}
                onForget={(value) => forgetGameSetupOption("tones", value)}
                selected={(value) => tones.includes(value)}
              />
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  type="text"
                  value={customTone}
                  onChange={(e) => setCustomTone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustomTone()}
                  placeholder="Add custom tone…"
                  className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-xs text-[var(--foreground)] outline-none ring-1 ring-transparent transition-all placeholder:text-[var(--muted-foreground)] focus:ring-[var(--primary)]/40"
                />
                <button
                  onClick={addCustomTone}
                  disabled={!customTone.trim()}
                  className="rounded-lg bg-[var(--secondary)] p-1.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)] disabled:opacity-40"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {/* Difficulty — single-select */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Difficulty</label>
              <div className="flex gap-1.5">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs transition-colors",
                      difficulty === d
                        ? "bg-[var(--primary)]/20 text-[var(--primary)] ring-1 ring-[var(--primary)]/40"
                        : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Content Rating */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Content Rating</label>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setRating("sfw")}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition-colors",
                    rating === "sfw"
                      ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40"
                      : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  SFW
                </button>
                <button
                  onClick={() => setRating("nsfw")}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition-colors",
                    rating === "nsfw"
                      ? "bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40"
                      : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  NSFW
                </button>
              </div>
              <p className="mt-1 text-[0.575rem] text-[var(--muted-foreground)]">
                {rating === "nsfw"
                  ? "Anything goes. Violence, dark themes, and explicit content are unrestricted."
                  : "Dark themes and profanity allowed, but explicit scenes cut to black."}
              </p>
            </div>

            {/* Language */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Language</label>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="English"
                className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none ring-1 ring-transparent transition-all placeholder:text-[var(--muted-foreground)] focus:ring-[var(--primary)]/40"
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {GAME_LANGUAGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setLanguage(option.label)}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[0.625rem] transition-colors",
                      normalizedLanguage === option.value
                        ? "bg-[var(--primary)]/20 text-[var(--primary)] ring-1 ring-[var(--primary)]/40"
                        : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[0.575rem] text-[var(--muted-foreground)]">
                All narration and dialogue will be written in this language.
              </p>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            {/* GM Mode */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Game Master Mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setGmMode("standalone")}
                  className={cn(
                    "flex-1 rounded-lg p-3 text-left text-xs transition-colors ring-1",
                    gmMode === "standalone"
                      ? "bg-[var(--primary)]/10 ring-[var(--primary)]/40"
                      : "bg-[var(--secondary)] ring-[var(--border)] hover:ring-[var(--primary)]/20",
                  )}
                >
                  <div className="font-medium text-[var(--foreground)]">Standalone GM</div>
                  <div className="mt-1 text-[var(--muted-foreground)]">A snarky narrator running the show</div>
                </button>
                <button
                  onClick={() => setGmMode("character")}
                  className={cn(
                    "flex-1 rounded-lg p-3 text-left text-xs transition-colors ring-1",
                    gmMode === "character"
                      ? "bg-[var(--primary)]/10 ring-[var(--primary)]/40"
                      : "bg-[var(--secondary)] ring-[var(--border)] hover:ring-[var(--primary)]/20",
                  )}
                >
                  <div className="font-medium text-[var(--foreground)]">Character GM</div>
                  <div className="mt-1 text-[var(--muted-foreground)]">Use an existing character as GM</div>
                </button>
              </div>
            </div>

            {/* GM Character selector */}
            {gmMode === "character" && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">GM Character</label>
                {/* Selected GM */}
                {gmCharacterId &&
                  (() => {
                    const c = characters.find((ch) => ch.id === gmCharacterId);
                    if (!c) return null;
                    return (
                      <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30">
                        <CharacterAvatar character={c} />
                        <span className="flex-1 truncate text-xs">{c.name}</span>
                        <button
                          onClick={() => setGmCharacterId(null)}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                          title="Remove"
                        >
                          <X size="0.6875rem" />
                        </button>
                      </div>
                    );
                  })()}
                {/* Search + list */}
                <div className="rounded-lg ring-1 ring-[var(--border)] bg-[var(--card)] overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                    <Search size="0.75rem" className="text-[var(--muted-foreground)]" />
                    <input
                      value={gmSearch}
                      onChange={(e) => setGmSearch(e.target.value)}
                      placeholder="Search characters…"
                      className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
                    />
                  </div>
                  <div className="max-h-32 overflow-y-auto">
                    {filteredGmCharacters.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setGmCharacterId(c.id === gmCharacterId ? null : c.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                          c.id === gmCharacterId && "bg-[var(--primary)]/5",
                        )}
                      >
                        <CharacterAvatar character={c} />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{c.name}</span>
                          {getCharacterTitle(c) && (
                            <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                              {getCharacterTitle(c)}
                            </span>
                          )}
                        </div>
                        {c.id === gmCharacterId && (
                          <span className="text-[0.625rem] text-[var(--primary)]">Selected</span>
                        )}
                      </button>
                    ))}
                    {filteredGmCharacters.length === 0 && (
                      <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                        {characters.length === 0 ? "No characters found." : "No matches."}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Party Members */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
                Party Members ({partyCharacterIds.length} selected)
              </label>
              {/* Selected party members */}
              {partyCharacterIds.length > 0 && (
                <div className="mb-2 flex flex-col gap-1">
                  {partyCharacterIds.map((cid) => {
                    const c = characters.find((ch) => ch.id === cid);
                    if (!c) return null;
                    return (
                      <div
                        key={cid}
                        className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                      >
                        <CharacterAvatar character={c} />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{c.name}</span>
                          {getCharacterTitle(c) && (
                            <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                              {getCharacterTitle(c)}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => togglePartyMember(cid)}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                          title="Remove"
                        >
                          <X size="0.6875rem" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Search + list */}
              <div className="rounded-lg ring-1 ring-[var(--border)] bg-[var(--card)] overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                  <Search size="0.75rem" className="text-[var(--muted-foreground)]" />
                  <input
                    value={partySearch}
                    onChange={(e) => setPartySearch(e.target.value)}
                    placeholder="Search characters…"
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
                  />
                </div>
                <div className="max-h-36 overflow-y-auto">
                  {filteredPartyCharacters.map((c) => {
                    const isSelected = partyCharacterIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => togglePartyMember(c.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                          isSelected && "bg-[var(--primary)]/5",
                        )}
                      >
                        <CharacterAvatar character={c} />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{c.name}</span>
                          {getCharacterTitle(c) && (
                            <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                              {getCharacterTitle(c)}
                            </span>
                          )}
                        </div>
                        {isSelected ? (
                          <span className="text-[0.625rem] text-[var(--primary)]">Added</span>
                        ) : (
                          <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
                        )}
                      </button>
                    );
                  })}
                  {filteredPartyCharacters.length === 0 && (
                    <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                      {characters.length === 0 ? "No characters found. Create characters first." : "No matches."}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            {/* Persona */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
                <User size={12} className="mr-1 inline" />
                Your Persona
              </label>
              {/* Selected persona */}
              {personaId &&
                (() => {
                  const p = personas.find((x) => x.id === personaId);
                  if (!p) return null;
                  const title = getPersonaTitle(p);
                  return (
                    <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30">
                      <CharacterAvatar
                        character={{
                          name: p.name,
                          avatarUrl: p.avatarPath ?? null,
                          avatarCrop: parseAvatarCropJson(p.avatarCrop),
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="block truncate text-xs">{p.name}</span>
                        {title && (
                          <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">{title}</span>
                        )}
                      </div>
                      <button
                        onClick={() => setPersonaId(null)}
                        className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                        title="Remove"
                      >
                        <X size="0.6875rem" />
                      </button>
                    </div>
                  );
                })()}
              <div className="rounded-lg ring-1 ring-[var(--border)] bg-[var(--card)] overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                  <Search size="0.75rem" className="text-[var(--muted-foreground)]" />
                  <input
                    value={personaSearch}
                    onChange={(e) => setPersonaSearch(e.target.value)}
                    placeholder="Search personas or titles…"
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
                  />
                </div>
                <div className="max-h-28 overflow-y-auto">
                  {filteredPersonas.map((p) => {
                    const title = getPersonaTitle(p);
                    return (
                      <button
                        key={p.id}
                        onClick={() => setPersonaId(p.id === personaId ? null : p.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                          p.id === personaId && "bg-[var(--primary)]/5",
                        )}
                      >
                        <CharacterAvatar
                          character={{
                            name: p.name,
                            avatarUrl: p.avatarPath ?? null,
                            avatarCrop: parseAvatarCropJson(p.avatarCrop),
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="block truncate text-xs">{p.name}</span>
                          {title && (
                            <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                              {title}
                            </span>
                          )}
                        </div>
                        {p.id === personaId && <span className="text-[0.625rem] text-[var(--primary)]">Selected</span>}
                      </button>
                    );
                  })}
                  {filteredPersonas.length === 0 && (
                    <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                      {personas.length === 0 ? "No personas found. Create one in the Personas panel." : "No matches."}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* GM Model */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
                <Plug size={12} className="mr-1 inline" />
                GM / Party Model
              </label>
              <select
                value={gmConnectionId ?? ""}
                onChange={(e) => setGmConnectionId(e.target.value || null)}
                className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none ring-1 ring-transparent transition-all focus:ring-[var(--primary)]/40"
              >
                <option value="">Select a connection…</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.model ? ` — ${c.model}` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[0.6875rem] leading-relaxed text-amber-800 dark:border-amber-500/25 dark:text-amber-100">
                <span className="font-semibold text-amber-900 dark:text-amber-200">Warning!</span> It&apos;s recommended
                you use a strong model (any SOTA one; the newest Opus, Gemini, GPT) for the initial generation for the
                best experience. You can change the model later, after the initial generation (in Chat Settings -&gt;
                Connection).
              </p>
              <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
                <button
                  onClick={() => setCustomizeParameters((prev) => !prev)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <span className="block text-xs font-medium text-[var(--foreground)]">Customize Parameters</span>
                    <span className="block text-[0.575rem] text-[var(--muted-foreground)]">
                      Leave this off to use the selected connection&apos;s saved defaults for the initial world build
                      and game chat.
                    </span>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 rounded-full p-0.5 transition-colors",
                      customizeParameters ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white transition-transform",
                        customizeParameters && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>
                {customizeParameters && (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    <GenerationParametersFields value={generationParameters} onChange={setGenerationParameters} />
                  </div>
                )}
              </div>
              {connections.length === 0 && (
                <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                  No connections configured. Add one in Settings → Connections.
                </p>
              )}
            </div>

            {/* Scene Effects Model — unified dropdown */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
                Scene Effects Model
                <span className="ml-1 text-[0.575rem] text-[var(--muted-foreground)]">(optional)</span>
              </label>
              <select
                value={sceneModelValue ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "local") {
                    setUseLocalScene(true);
                    setSceneConnectionId(null);
                  } else {
                    setUseLocalScene(false);
                    setSceneConnectionId(v || null);
                  }
                }}
                className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none ring-1 ring-transparent transition-all focus:ring-[var(--primary)]/40"
              >
                <option value="">Skip — use inline tags from GM</option>
                {sidecarAvailable && <option value="local">Local Model (Gemma)</option>}
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.model ? ` — ${c.model}` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[0.575rem] text-[var(--muted-foreground)]">
                {sceneModelValue === "local"
                  ? "Gemma handles backgrounds, music, weather, and cinematic effects. The GM handles narration, widgets, and expressions."
                  : "Handles backgrounds, music, weather, and cinematic effects after each GM turn. If skipped, the GM model handles scene tags inline."}
              </p>
            </div>

            {/* Game Features */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Game Features</label>
              <div className="space-y-2">
                <div>
                  <button
                    type="button"
                    onClick={() => setEnableSpotifyDj((prev) => !prev)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                      enableSpotifyDj
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] ring-1 ring-transparent hover:ring-[var(--border)]",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <Music2
                        size={14}
                        className={enableSpotifyDj ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}
                      />
                      <div className="min-w-0">
                        <span className="block text-xs font-medium text-[var(--foreground)]">Spotify DJ Music</span>
                        <span className="block text-[0.575rem] text-[var(--muted-foreground)]">
                          Use Spotify music for this game instead of local music assets
                        </span>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                        enableSpotifyDj ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white transition-transform",
                          enableSpotifyDj && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>

                  {enableSpotifyDj && (
                    <div className="mt-2 space-y-2 rounded-lg bg-[var(--background)]/55 p-3 ring-1 ring-[var(--border)]">
                      <label className="flex flex-col gap-1">
                        <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Music source</span>
                        <select
                          value={gameSpotifySourceType}
                          onChange={(event) => {
                            const next = normalizeGameSpotifySourceType(event.target.value);
                            setGameSpotifySourceType(next);
                            if (next !== "playlist") {
                              setGameSpotifyPlaylistId("");
                              setGameSpotifyPlaylistName("");
                            }
                            if (next !== "artist") {
                              setGameSpotifyArtist("");
                            }
                          }}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"
                        >
                          {GAME_SPOTIFY_SOURCE_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span className="text-[0.5625rem] text-[var(--muted-foreground)]">
                          {GAME_SPOTIFY_SOURCE_OPTIONS.find((option) => option.id === gameSpotifySourceType)
                            ?.description ?? ""}
                        </span>
                      </label>

                      {gameSpotifySourceType === "playlist" && (
                        <label className="flex flex-col gap-1">
                          <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Playlist</span>
                          {spotifyPlaylistsQuery.data?.playlists.length ? (
                            <select
                              value={gameSpotifyPlaylistId}
                              onChange={(event) => {
                                const playlist = spotifyPlaylistsQuery.data?.playlists.find(
                                  (entry) => entry.id === event.target.value,
                                );
                                setGameSpotifyPlaylistId(event.target.value);
                                setGameSpotifyPlaylistName(playlist?.name ?? "");
                              }}
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"
                            >
                              <option value="">Choose playlist...</option>
                              {spotifyPlaylistsQuery.data.playlists.map((playlist) => {
                                const suffix =
                                  typeof playlist.trackCount === "number"
                                    ? ` (${playlist.trackCount})`
                                    : playlist.owned === false
                                      ? " (followed — unavailable)"
                                      : "";
                                return (
                                  <option key={playlist.id} value={playlist.id}>
                                    {playlist.name}
                                    {suffix}
                                  </option>
                                );
                              })}
                            </select>
                          ) : (
                            <input
                              value={gameSpotifyPlaylistId}
                              onChange={(event) => {
                                setGameSpotifyPlaylistId(event.target.value);
                                setGameSpotifyPlaylistName("");
                              }}
                              placeholder={
                                spotifyPlaylistsQuery.isFetching ? "Loading playlists..." : "Paste playlist ID"
                              }
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50"
                            />
                          )}
                          {spotifyPlaylistsQuery.isError && (
                            <span className="text-[0.5625rem] text-amber-400/90">
                              Connect Spotify in the Spotify DJ agent to load playlist names.
                            </span>
                          )}
                        </label>
                      )}

                      {gameSpotifySourceType === "artist" && (
                        <label className="flex flex-col gap-1">
                          <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Artist</span>
                          <input
                            value={gameSpotifyArtist}
                            onChange={(event) => setGameSpotifyArtist(event.target.value)}
                            placeholder="HOYO-MiX"
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50"
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setEnableLorebookKeeper((prev) => !prev)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                    enableLorebookKeeper
                      ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                      : "bg-[var(--secondary)] ring-1 ring-transparent hover:ring-[var(--border)]",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <BookOpen
                      size={14}
                      className={enableLorebookKeeper ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}
                    />
                    <div className="min-w-0">
                      <span className="block text-xs font-medium text-[var(--foreground)]">Lorebook Keeper</span>
                      <span className="block text-[0.575rem] text-[var(--muted-foreground)]">
                        Keep a game lorebook updated as the adventure develops
                      </span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      enableLorebookKeeper ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white transition-transform",
                        enableLorebookKeeper && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>

                <div>
                  <button
                    onClick={() => setEnableSpriteGeneration(!enableSpriteGeneration)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all",
                      enableSpriteGeneration
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] ring-1 ring-transparent hover:ring-[var(--border)]",
                    )}
                  >
                    <Image
                      size={14}
                      className={enableSpriteGeneration ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}
                    />
                    <div className="flex-1">
                      <span className="block text-xs font-medium text-[var(--foreground)]">Image Generation</span>
                      <span className="block text-[0.575rem] text-[var(--muted-foreground)]">
                        Auto-generate NPC portraits and location backgrounds during gameplay
                      </span>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 rounded-full p-0.5 transition-colors",
                        enableSpriteGeneration ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white transition-transform",
                          enableSpriteGeneration && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>

                  {/* Image Connection Picker — shown when sprite gen is enabled */}
                  {enableSpriteGeneration && (
                    <div className="mt-2">
                      <label className="mb-1 block text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                        Image Generation Connection
                      </label>
                      <select
                        value={imageConnectionId ?? ""}
                        onChange={(e) => setImageConnectionId(e.target.value || null)}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"
                      >
                        <option value="">Select image connection…</option>
                        {imageConnections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.model ? ` — ${c.model}` : ""}
                          </option>
                        ))}
                      </select>
                      {imageConnections.length === 0 && (
                        <p className="mt-1 text-[0.55rem] text-amber-700 dark:text-amber-400/80">
                          No image generation connections found. Add one in Settings → Connections.
                        </p>
                      )}
                      <p className="mt-1 text-[0.55rem] text-[var(--muted-foreground)]">
                        Generates portraits for new NPCs and backgrounds for new locations using the scene analysis
                        pipeline.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Custom Widgets Toggle */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
              <button
                onClick={() => setEnableCustomWidgets(!enableCustomWidgets)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <div className="flex items-center gap-2">
                  <Sparkles
                    size={14}
                    className={enableCustomWidgets ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}
                  />
                  <div>
                    <p className="text-xs font-medium text-[var(--foreground)]">Custom HUD Widgets</p>
                    <p className="text-[0.55rem] text-[var(--muted-foreground)]">
                      Model designs custom widgets (health bars, inventories, etc.) for the game HUD
                    </p>
                  </div>
                </div>
                <div
                  className={cn(
                    "flex h-5 w-8 items-center rounded-full px-0.5 transition-colors",
                    enableCustomWidgets ? "bg-[var(--primary)]" : "bg-[var(--secondary)]",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white transition-transform",
                      enableCustomWidgets && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            {/* Player Goals */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Player Goals</label>
              <textarea
                value={playerGoals}
                onChange={(e) => setPlayerGoals(e.target.value)}
                placeholder="What do you want to achieve?"
                rows={3}
                className="w-full resize-none rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none ring-1 ring-transparent transition-all placeholder:text-[var(--muted-foreground)] focus:ring-[var(--primary)]/40"
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {GOAL_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => applySuggestion(setPlayerGoals, s)}
                    className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)] hover:bg-[var(--primary)]/10"
                  >
                    {s === "Surprise me!" && <Sparkles size={9} />}
                    {s}
                  </button>
                ))}
              </div>
              <LearnedOptionChips
                options={learnedGoals}
                expanded={expandedLearnedOptions.goals}
                onToggleExpanded={() => toggleLearnedOptions("goals")}
                onSelect={setPlayerGoals}
                onForget={(value) => forgetGameSetupOption("goals", value)}
              />
            </div>

            {/* Preferences */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
                Additional Preferences
              </label>
              <textarea
                value={preferences}
                onChange={(e) => setPreferences(e.target.value)}
                placeholder="Any extra details for the GM?"
                rows={3}
                className="w-full resize-none rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none ring-1 ring-transparent transition-all placeholder:text-[var(--muted-foreground)] focus:ring-[var(--primary)]/40"
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {PREFERENCE_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setPreferences((prev) => (prev ? `${prev}, ${s.toLowerCase()}` : s))}
                    className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)] hover:bg-[var(--primary)]/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <LearnedOptionChips
                options={learnedPreferences}
                expanded={expandedLearnedOptions.preferences}
                onToggleExpanded={() => toggleLearnedOptions("preferences")}
                onSelect={setPreferences}
                onForget={(value) => forgetGameSetupOption("preferences", value)}
              />
            </div>

            {/* Lorebooks */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
                <BookOpen size={12} className="mr-1 inline" />
                Lorebooks
              </label>
              <p className="mb-2 text-[0.55rem] text-[var(--muted-foreground)]">
                Attach lorebooks to inject world lore, character info, and other context into game generations.
              </p>

              {/* Active lorebooks */}
              {activeLorebookIds.length > 0 && (
                <div className="mb-2 flex flex-col gap-1">
                  {activeLorebookIds.map((lbId) => {
                    const lb = lorebooks.find((l) => l.id === lbId);
                    if (!lb) return null;
                    return (
                      <div
                        key={lb.id}
                        className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-1.5 ring-1 ring-[var(--primary)]/30"
                      >
                        <BookOpen size={12} className="text-[var(--primary)]" />
                        <span className="flex-1 truncate text-xs">{lb.name}</span>
                        <button
                          onClick={() => toggleLorebook(lb.id)}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                          title="Remove"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Search + add */}
              <div className="overflow-hidden rounded-lg ring-1 ring-[var(--border)] bg-[var(--card)]">
                <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
                  <Search size={12} className="text-[var(--muted-foreground)]" />
                  <input
                    value={lbSearch}
                    onChange={(e) => setLbSearch(e.target.value)}
                    placeholder="Search lorebooks…"
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
                  />
                </div>
                <div className="max-h-28 overflow-y-auto">
                  {availableLorebooks.map((lb) => (
                    <button
                      key={lb.id}
                      onClick={() => toggleLorebook(lb.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-all hover:bg-[var(--accent)]"
                    >
                      <BookOpen size={12} className="text-[var(--muted-foreground)]" />
                      <span className="flex-1 truncate text-xs">{lb.name}</span>
                      <Plus size={12} className="text-[var(--muted-foreground)]" />
                    </button>
                  ))}
                  {availableLorebooks.length === 0 && (
                    <p className="px-3 py-2 text-[0.625rem] text-[var(--muted-foreground)]">
                      {lorebooks.filter((lb) => !activeLorebookIds.includes(lb.id)).length === 0
                        ? "All lorebooks already added."
                        : "No matches."}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Start Muted */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
              <button
                onClick={() => setStartMuted(!startMuted)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <div className="flex items-center gap-2">
                  {startMuted ? (
                    <VolumeX size={14} className="text-[var(--muted-foreground)]" />
                  ) : (
                    <Volume2 size={14} className="text-[var(--primary)]" />
                  )}
                  <div>
                    <p className="text-xs font-medium text-[var(--foreground)]">Start Muted</p>
                    <p className="text-[0.55rem] text-[var(--muted-foreground)]">Begin the game with all audio muted</p>
                  </div>
                </div>
                <div
                  className={cn(
                    "flex h-5 w-8 items-center rounded-full px-0.5 transition-colors",
                    startMuted ? "bg-[var(--primary)]" : "bg-[var(--secondary)]",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white transition-transform",
                      startMuted && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Warning when model not selected */}
      {step === steps.length - 1 && !canStart && (
        <p className="mb-3 text-[0.6875rem] text-[var(--destructive)]">
          Select a GM model on the &quot;You &amp; Model&quot; step before starting.
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-[var(--border)]/30 pt-4">
        <button
          onClick={step === 0 ? onCancel : () => setStep(step - 1)}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] hover:bg-[var(--secondary)]"
        >
          <ArrowLeft size={14} />
          {step === 0 ? "Cancel" : "Back"}
        </button>

        {step < steps.length - 1 ? (
          <button
            onClick={() => setStep(step + 1)}
            className="flex items-center gap-1 rounded-lg bg-[var(--primary)]/15 px-3 py-1.5 text-xs font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/25"
          >
            Next
            <ArrowRight size={14} />
          </button>
        ) : (
          <button
            onClick={handleComplete}
            disabled={isLoading || !canStart}
            className="flex items-center gap-1 rounded-lg bg-[var(--primary)] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            title={!canStart ? "Select a GM model on the You & Model step" : undefined}
          >
            {isLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generating World…
              </>
            ) : (
              <>
                <Wand2 size={14} />
                Start Game
              </>
            )}
          </button>
        )}
      </div>
    </Modal>
  );
}
