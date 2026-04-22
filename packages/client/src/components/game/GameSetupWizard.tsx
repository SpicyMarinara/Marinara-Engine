// ──────────────────────────────────────────────
// Game: Setup Wizard (initial game setup modal)
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback, useEffect } from "react";
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
} from "lucide-react";
import type { GameSetupConfig, GameGmMode } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
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

interface GameSetupWizardProps {
  onComplete: (
    config: GameSetupConfig,
    preferences: string,
    connections: { gmConnectionId?: string; characterConnectionId?: string },
    gameName?: string,
  ) => void;
  onCancel: () => void;
  isLoading: boolean;
  characters: Array<{ id: string; name: string; avatarUrl?: string | null }>;
}

interface PersonaDisplayInfo {
  name: string;
  comment?: string | null;
}

function getPersonaTitle(persona: PersonaDisplayInfo): string | null {
  const title = persona.comment?.trim();
  return title ? title : null;
}

const GENRES = ["Fantasy", "Sci-Fi", "Horror", "Modern", "Post-Apocalyptic", "Cyberpunk", "Steampunk", "Historical"];
const TONES = ["Heroic", "Dark", "Comedic", "Gritty", "Whimsical", "Serious", "Campy"];
const DIFFICULTIES = ["Casual", "Normal", "Hard", "Brutal"];

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
  const [playerGoals, setPlayerGoals] = useState("");
  const [preferences, setPreferences] = useState("");
  const [gmSearch, setGmSearch] = useState("");
  const [partySearch, setPartySearch] = useState("");
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [gmConnectionId, setGmConnectionId] = useState<string | null>(null);
  const [customizeParameters, setCustomizeParameters] = useState(false);
  const [generationParameters, setGenerationParameters] =
    useState<EditableGenerationParameters>(ROLEPLAY_PARAMETER_DEFAULTS);
  const [charConnectionId, setCharConnectionId] = useState<string | null>(null);
  const [sameConnection, setSameConnection] = useState(true);
  const [personaSearch, setPersonaSearch] = useState("");
  const [rating, setRating] = useState<"sfw" | "nsfw">("sfw");
  const [useLocalScene, setUseLocalScene] = useState(true);
  const [enableSpriteGeneration, setEnableSpriteGeneration] = useState(false);
  const [imageConnectionId, setImageConnectionId] = useState<string | null>(null);
  const [sceneConnectionId, setSceneConnectionId] = useState<string | null>(null);
  const [activeLorebookIds, setActiveLorebookIds] = useState<string[]>([]);
  const [lbSearch, setLbSearch] = useState("");
  const [enableCustomWidgets, setEnableCustomWidgets] = useState(true);
  const [language, setLanguage] = useState("English");

  const sidecarStatus = useSidecarStore((s) => s.status);
  const sidecarConfig = useSidecarStore((s) => s.config);
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
    () => (personasList as Array<{ id: string; name: string; avatarPath?: string | null; comment?: string }>) ?? [],
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
    () => characters.filter((c) => c.name.toLowerCase().includes(gmSearch.toLowerCase())),
    [characters, gmSearch],
  );

  const filteredPartyCharacters = useMemo(
    () => characters.filter((c) => c.id !== gmCharacterId && c.name.toLowerCase().includes(partySearch.toLowerCase())),
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

  const handleComplete = () => {
    if (isLoading || !canStart) return;
    // Sync the wizard's local-scene toggle to the global sidecar config
    if (sidecarAvailable) {
      useSidecarStore.getState().updateConfig({ useForGameScene: sceneModelValue === "local" });
    }
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
        language: language.trim() || undefined,
        generationParameters: customizeParameters ? generationParameters : undefined,
      },
      preferences,
      {
        gmConnectionId: gmConnectionId ?? undefined,
        characterConnectionId: sameConnection ? (gmConnectionId ?? undefined) : (charConnectionId ?? undefined),
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
                {["English", "日本語", "한국어", "中文", "Español", "Français", "Deutsch", "Português", "Русский"].map(
                  (lang) => (
                    <button
                      key={lang}
                      onClick={() => setLanguage(lang)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[0.625rem] transition-colors",
                        language === lang
                          ? "bg-[var(--primary)]/20 text-[var(--primary)] ring-1 ring-[var(--primary)]/40"
                          : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10",
                      )}
                    >
                      {lang}
                    </button>
                  ),
                )}
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
                        {c.avatarUrl ? (
                          <img
                            src={c.avatarUrl}
                            alt={c.name}
                            loading="lazy"
                            className="h-6 w-6 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                            {c.name[0]}
                          </div>
                        )}
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
                        {c.avatarUrl ? (
                          <img
                            src={c.avatarUrl}
                            alt={c.name}
                            loading="lazy"
                            className="h-6 w-6 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                            {c.name[0]}
                          </div>
                        )}
                        <span className="flex-1 truncate text-xs">{c.name}</span>
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
                        {c.avatarUrl ? (
                          <img
                            src={c.avatarUrl}
                            alt={c.name}
                            loading="lazy"
                            className="h-6 w-6 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                            {c.name[0]}
                          </div>
                        )}
                        <span className="flex-1 truncate text-xs">{c.name}</span>
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
                        {c.avatarUrl ? (
                          <img
                            src={c.avatarUrl}
                            alt={c.name}
                            loading="lazy"
                            className="h-6 w-6 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                            {c.name[0]}
                          </div>
                        )}
                        <span className="flex-1 truncate text-xs">{c.name}</span>
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
                      {p.avatarPath ? (
                        <img
                          src={p.avatarPath}
                          alt={p.name}
                          loading="lazy"
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                          {p.name[0]}
                        </div>
                      )}
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
                        {p.avatarPath ? (
                          <img
                            src={p.avatarPath}
                            alt={p.name}
                            loading="lazy"
                            className="h-6 w-6 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                            {p.name[0]}
                          </div>
                        )}
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
                GM Model
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
              <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[0.6875rem] leading-relaxed text-amber-100">
                <span className="font-semibold text-amber-200">Warning!</span> It&apos;s recommended you use a strong
                model (any SOTA one; the newest Opus, Gemini, GPT) for the initial generation for the best experience.
                You can change the model later, after the initial generation (in Chat Settings -&gt; Connection).
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

            {/* Character Model */}
            <div>
              <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-[var(--foreground)]">
                Character Model
                <button
                  onClick={() => setSameConnection(!sameConnection)}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.625rem] transition-colors",
                    sameConnection
                      ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                      : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
                  )}
                >
                  {sameConnection ? "Same as GM" : "Different"}
                </button>
              </label>
              {!sameConnection && (
                <select
                  value={charConnectionId ?? ""}
                  onChange={(e) => setCharConnectionId(e.target.value || null)}
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
                  ? "Gemma handles backgrounds, music, widgets, expressions, and weather. Main model focuses on narration only."
                  : "Handles backgrounds, music, widgets, and expressions after each GM turn. If skipped, the GM model handles scene tags inline."}
              </p>
            </div>

            {/* Sprite Generation */}
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
                    <p className="mt-1 text-[0.55rem] text-amber-400/80">
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
                {["Include romance subplot", "Focus on exploration", "Make NPCs memorable", "Keep it short"].map(
                  (s) => (
                    <button
                      key={s}
                      onClick={() => setPreferences((prev) => (prev ? `${prev}, ${s.toLowerCase()}` : s))}
                      className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)] hover:bg-[var(--primary)]/10"
                    >
                      {s}
                    </button>
                  ),
                )}
              </div>
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
