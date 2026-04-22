// ──────────────────────────────────────────────
// Game: Main Surface (rendered by ChatArea when mode === "game")
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { useGameModeStore } from "../../stores/game-mode.store";
import { useGameAssetStore } from "../../stores/game-asset.store";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { useGameStateStore } from "../../stores/game-state.store";
import {
  useSyncGameState,
  useCreateGame,
  useGameSetup,
  useStartGame,
  useRollDice,
  useSkillCheck,
  useMoveOnMap,
  useConcludeSession,
  useStartSession,
  useGenerateMap,
  useAdvanceTime,
  useUpdateWeather,
  useRollEncounter,
  useUpdateReputation,
  useJournalEntry,
  useTransitionGameState,
} from "../../hooks/use-game";
import { useDeleteChat, useUpdateChatMetadata } from "../../hooks/use-chats";
import { useGenerate } from "../../hooks/use-generate";
import { useQueries, useQuery } from "@tanstack/react-query";
import { spriteKeys, type SpriteInfo } from "../../hooks/use-characters";
import { api } from "../../lib/api-client";
import { cn } from "../../lib/utils";
import { audioManager } from "../../lib/game-audio";
import { parseGmTags } from "../../lib/game-tag-parser";
import { resolveAssetTag } from "../../lib/asset-fuzzy-match";
import type { CombatEncounterTag } from "../../lib/game-tag-parser";
import { useSceneAnalysis } from "../../hooks/use-scene-analysis";
import { useSidecarStore } from "../../stores/sidecar.store";
import { parsePartyDialogue } from "../../lib/party-dialogue-parser";
import type { PartyDialogueLine, CombatSummary } from "@marinara-engine/shared";
import type { SceneSegmentEffect } from "@marinara-engine/shared";
import { scoreMusic, scoreAmbient } from "@marinara-engine/shared";
import { GameNarration } from "./GameNarration";
import { GameInput } from "./GameInput";
import { GameMapPanel, MobileMapButton } from "./GameMap";
import { GamePartyBar } from "./GamePartyBar";
import { GameCharacterSheet } from "@/components/game/GameCharacterSheet";
import type { GameCharacterSheetGameCard } from "@/components/game/GameCharacterSheet";
import { GameSetupWizard } from "./GameSetupWizard";
import { GameDiceResult } from "./GameDiceResult";
import { GameSkillCheckResult } from "./GameSkillCheckResult";
import { GameElementReaction } from "./GameElementReaction";
import { GameTravelView } from "./GameTravelView";
import { GameSessionHistory } from "./GameSessionHistory";
import { GameTransitionManager } from "./GameTransitionManager";
import { GameChoiceCards } from "./GameChoiceCards";
import { GameQteOverlay } from "./GameQteOverlay";
import { GameJournal } from "./GameJournal";
import { GameCombatUI } from "./GameCombatUI";
import { GameTutorial } from "./GameTutorial";
import { DirectionEngine } from "./DirectionEngine";
import { GameWidgetPanel, MobileWidgetPanel } from "./GameWidgetPanel";
import { WeatherEffects } from "../chat/WeatherEffects";
import { GameInventory } from "./GameInventory";
import { GameReadableDisplay } from "./GameReadableDisplay";
import { ChatGalleryDrawer } from "../chat/ChatGalleryDrawer";
import type { ReadableTag } from "../../lib/game-tag-parser";

const SpriteOverlay = lazy(async () => {
  const module = await import("../chat/SpriteOverlay");
  return { default: module.SpriteOverlay };
});

import { Modal } from "../ui/Modal";
import type { Chat, SessionSummary, Combatant, Message } from "@marinara-engine/shared";
import type { PersonaInfo } from "../chat/chat-area.types";

/** Typewriter component for the intro screen — reveals text character-by-character. */
function IntroTypewriter({ text, onComplete }: { text: string; onComplete?: () => void }) {
  const [visible, setVisible] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const firedRef = useRef(false);
  useEffect(() => {
    if (visible >= text.length) {
      if (!firedRef.current) {
        firedRef.current = true;
        onComplete?.();
      }
      return;
    }
    const t = window.setTimeout(() => setVisible((v) => v + 1), 28);
    return () => window.clearTimeout(t);
  }, [visible, text.length, onComplete]);
  // Auto-scroll to bottom as text is revealed
  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
  }, [visible]);
  return (
    <div ref={containerRef} className="overflow-y-auto">
      <p className="text-sm leading-relaxed text-white/70 whitespace-pre-line">
        {text.slice(0, visible)}
        {visible < text.length && <span className="animate-pulse text-white/40">▌</span>}
      </p>
    </div>
  );
}

import {
  AlertTriangle,
  BookOpen,
  HelpCircle,
  History,
  Image,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

/** Randomly sample up to `max` items from an array (Fisher-Yates shuffle). */
function sampleTags(tags: string[], max: number): string[] {
  if (tags.length <= max) return tags;
  const shuffled = [...tags];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, max);
}

interface GameSurfaceProps {
  activeChatId: string;
  chat: Chat;
  chatMeta: Record<string, unknown>;
  messages: Message[];
  isStreaming: boolean;
  isMessagesLoading: boolean;
  characterMap: Map<string, { name: string; avatarUrl?: string | null; dialogueColor?: string; nameColor?: string }>;
  characters: Array<{
    id: string;
    name: string;
    avatarUrl?: string;
    description?: string;
    personality?: string;
    backstory?: string;
    appearance?: string;
    tags?: string[];
  }>;
  personaInfo?: PersonaInfo;
  chatBackground?: string | null;
  onOpenSettings: () => void;
  onDeleteMessage: (messageId: string) => void;
}

export function GameSurface({
  activeChatId,
  chat,
  chatMeta,
  messages,
  isStreaming,
  characterMap,
  characters,
  personaInfo,
  chatBackground: _chatBackground,
  onOpenSettings,
  onDeleteMessage,
  isMessagesLoading,
}: GameSurfaceProps) {
  // Sync game metadata → store
  useSyncGameState(activeChatId, chatMeta);

  const {
    gameState,
    currentMap,
    sessionNumber,
    isSetupActive,
    diceRollResult,
    npcs,
    hudWidgets,
    blueprint,
    characterSheetOpen,
    characterSheetCharId,
  } = useGameModeStore(
    useShallow((s) => ({
      gameState: s.gameState,
      currentMap: s.currentMap,
      sessionNumber: s.sessionNumber,
      isSetupActive: s.isSetupActive,
      diceRollResult: s.diceRollResult,
      npcs: s.npcs,
      hudWidgets: s.hudWidgets,
      blueprint: s.blueprint,
      characterSheetOpen: s.characterSheetOpen,
      characterSheetCharId: s.characterSheetCharId,
    })),
  );

  const closeCharacterSheet = useGameModeStore((s) => s.closeCharacterSheet);
  const applyWidgetUpdate = useGameModeStore((s) => s.applyWidgetUpdate);
  const setDiceRollResult = useGameModeStore((s) => s.setDiceRollResult);
  const weatherEffectsEnabled = useUIStore((s) => s.weatherEffects);
  const gameTutorialDisabled = useUIStore((s) => s.gameTutorialDisabled);
  const setGameTutorialDisabled = useUIStore((s) => s.setGameTutorialDisabled);
  const gameSnapshot = useGameStateStore((s) => (s.current?.chatId === activeChatId ? s.current : null));

  /** Build weather string from chatMeta.gameWeather if available. */
  const metaWeather = (chatMeta.gameWeather as { type?: string; temperature?: number } | undefined)?.type ?? null;
  const metaTime = useMemo(() => {
    const gt = chatMeta.gameTime as { day?: number; hour?: number; minute?: number } | undefined;
    if (!gt || gt.hour == null) return null;
    const tod =
      gt.hour >= 5 && gt.hour < 7
        ? "dawn"
        : gt.hour >= 7 && gt.hour < 12
          ? "morning"
          : gt.hour >= 12 && gt.hour < 17
            ? "afternoon"
            : gt.hour >= 17 && gt.hour < 20
              ? "evening"
              : "night";
    const h = String(gt.hour ?? 0).padStart(2, "0");
    const m = String(gt.minute ?? 0).padStart(2, "0");
    return `Day ${gt.day ?? 1}, ${h}:${m} (${tod})`;
  }, [chatMeta.gameTime]);

  // ── Fetch game state on mount (WeatherEffects needs weather/time from the DB) ──
  useEffect(() => {
    const existing = useGameStateStore.getState().current;
    if (existing?.chatId === activeChatId) return;
    api
      .get<import("@marinara-engine/shared").GameState | null>(`/chats/${activeChatId}/game-state`)
      .then((gs) => {
        if (gs) {
          useGameStateStore.getState().setGameState(gs);
        }
      })
      .catch(() => {});
  }, [activeChatId]);

  // ── Patch game state snapshot with chatMeta weather/time when the snapshot is missing them ──
  // This handles: (a) server snapshot has no weather/time, (b) chatMeta loaded after the fetch,
  // (c) no server snapshot at all (creates a minimal one from chatMeta).
  useEffect(() => {
    if (!metaWeather && !metaTime) return;
    const current = useGameStateStore.getState().current;

    if (current?.chatId === activeChatId) {
      // Snapshot exists — enrich missing fields
      if ((!current.weather && metaWeather) || (!current.time && metaTime)) {
        useGameStateStore.getState().setGameState({
          ...current,
          ...(!current.weather && metaWeather ? { weather: metaWeather } : {}),
          ...(!current.time && metaTime ? { time: metaTime } : {}),
        });
      }
    } else {
      // No snapshot at all — create minimal from chatMeta so WeatherEffects renders
      useGameStateStore.getState().setGameState({
        id: "",
        chatId: activeChatId,
        messageId: "",
        swipeIndex: 0,
        date: null,
        time: metaTime,
        location: null,
        weather: metaWeather,
        temperature: null,
        presentCharacters: [],
        recentEvents: [],
        playerStats: null,
        personaStats: null,
        createdAt: "",
      });
    }
  }, [activeChatId, metaWeather, metaTime]);

  // ── Client-side backup: ensure location is added to journal when game state reports one ──
  const lastJournaledLocationRef = useRef<string | null>(null);
  useEffect(() => {
    const loc = gameSnapshot?.location;
    if (!loc || loc === lastJournaledLocationRef.current) return;
    lastJournaledLocationRef.current = loc;
    // Fire-and-forget: addLocationEntry on the server dedupes, so this is safe to call redundantly
    api
      .post("/game/journal/entry", {
        chatId: activeChatId,
        type: "location",
        data: { location: loc, description: `The party is at ${loc}.` },
      })
      .catch(() => {});
  }, [activeChatId, gameSnapshot?.location]);

  // Asset store
  const assetManifest = useGameAssetStore((s) => s.manifest);
  const currentBackground = useGameAssetStore((s) => s.currentBackground);
  const audioMuted = useGameAssetStore((s) => s.audioMuted);
  const fetchManifest = useGameAssetStore((s) => s.fetchManifest);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [confirmEndSessionOpen, setConfirmEndSessionOpen] = useState(false);
  const [activeChoices, setActiveChoices] = useState<string[] | null>(null);
  const [activeQte, setActiveQte] = useState<{ actions: string[]; timer: number } | null>(null);
  const [queuedQte, setQueuedQte] = useState<{ qte: { actions: string[]; timer: number }; messageId: string } | null>(
    null,
  );
  const [combatParty, setCombatParty] = useState<Combatant[] | null>(null);
  const [combatEnemies, setCombatEnemies] = useState<Combatant[] | null>(null);
  const [pendingEncounter, setPendingEncounter] = useState<CombatEncounterTag | null>(null);
  const [queuedEncounter, setQueuedEncounter] = useState<{ encounter: CombatEncounterTag; messageId: string } | null>(
    null,
  );
  const [pendingSkillCheck, setPendingSkillCheck] = useState<import("@marinara-engine/shared").SkillCheckResult | null>(
    null,
  );
  const [pendingReaction, setPendingReaction] = useState<{
    reaction: string;
    description: string;
    damageMultiplier: number;
    attackerName: string;
    defenderName: string;
    element?: string;
  } | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<{ name: string; avatarUrl: string; expression?: string } | null>(
    null,
  );
  const [activeDirections, setActiveDirections] = useState<import("@marinara-engine/shared").DirectionCommand[]>([]);
  const [partyDialogue, setPartyDialogue] = useState<PartyDialogueLine[]>([]);
  // Populated only from legacy `[party-chat]` history messages so existing saves
  // still render party overlay boxes. Never set by a new-turn pipeline — the GM
  // now voices party members inline via the `[Name] [main] ...` format.
  const [partyChatMessageId, setPartyChatMessageId] = useState<string | null>(null);
  const [narrationDone, setNarrationDone] = useState(false);
  const [directionsPlaying, setDirectionsPlaying] = useState(false);
  const [pendingSegmentEffects, setPendingSegmentEffects] = useState<SceneSegmentEffect[]>([]);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<Array<{ name: string; quantity: number }>>(() => {
    return (chatMeta.gameInventory as Array<{ name: string; quantity: number }>) ?? [];
  });
  const [inventoryNotifications, setInventoryNotifications] = useState<string[]>([]);
  const [pendingMapMove, setPendingMapMove] = useState<{
    position: { x: number; y: number } | string;
    label: string;
  } | null>(null);
  const [startSessionRequested, setStartSessionRequested] = useState(false);
  const [activeReadable, setActiveReadable] = useState<ReadableTag | null>(null);
  const readableQueueRef = useRef<ReadableTag[]>([]);
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startSessionGuardRef = useRef(false);

  // Handle readable segments from GameNarration: queue them and show one at a time
  const handleReadable = useCallback(
    (readable: { type: "note" | "book"; content: string }) => {
      // Save to journal
      api
        .post("/game/journal/entry", {
          chatId: activeChatId,
          type: "note",
          data: {
            title: readable.type === "book" ? "Book" : "Note",
            content: readable.content,
          },
        })
        .catch(() => {});

      if (activeReadable) {
        // Another readable is already open — queue this one
        readableQueueRef.current.push(readable);
      } else {
        setActiveReadable(readable);
      }
    },
    [activeChatId, activeReadable],
  );

  // Derive segment edit overlays from chatMeta, with local state for optimistic updates
  const [segmentEdits, setSegmentEdits] = useState(() => {
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(chatMeta)) {
      if (key.startsWith("segmentEdit:") && typeof value === "string") {
        map.set(key.slice("segmentEdit:".length), value);
      }
    }
    return map;
  });
  // Re-sync from chatMeta when it changes (e.g. page refresh loads new metadata)
  useEffect(() => {
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(chatMeta)) {
      if (key.startsWith("segmentEdit:") && typeof value === "string") {
        map.set(key.slice("segmentEdit:".length), value);
      }
    }
    setSegmentEdits(map);
  }, [chatMeta]);

  const appliedSegmentsRef = useRef<Set<number>>(new Set());
  const introPlayedRef = useRef(false);
  const [introCinematicActive, setIntroCinematicActive] = useState(false);
  const [introTypewriterDone, setIntroTypewriterDone] = useState(false);
  const [sceneAnalysisFailed, setSceneAnalysisFailed] = useState(false);
  const [sceneStuckVisible, setSceneStuckVisible] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [pendingAssetGeneration, setPendingAssetGeneration] = useState<{
    chatId: string;
    backgroundTag?: string;
    npcsNeedingAvatars?: Array<{ name: string; description: string }>;
  } | null>(null);
  const [assetGenerationFailed, setAssetGenerationFailed] = useState(false);
  const [volumePopoverOpen, setVolumePopoverOpen] = useState(false);
  const [masterVolume, setMasterVolume] = useState(50);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const tutorialAutoTriggeredRef = useRef(false);
  const volumePopoverRef = useRef<HTMLDivElement>(null);
  const hudSurfaceRef = useRef<HTMLDivElement>(null);
  const lastProcessedMsgRef = useRef<string | null>(null);
  const weatherMsgRef = useRef<string | null>(null);
  const sceneAnalysisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const introPresentationStorageKey = `game-intro-presented:${activeChatId}`;
  const assistantTurnCount = useMemo(
    () => messages.filter((m) => (m.role === "assistant" || m.role === "narrator") && !!m.content.trim()).length,
    [messages],
  );
  const [introPresented, setIntroPresented] = useState(false);

  useEffect(() => {
    let persisted = false;
    try {
      persisted = localStorage.getItem(introPresentationStorageKey) === "1";
    } catch {
      persisted = false;
    }
    setIntroPresented(persisted || assistantTurnCount > 1);
  }, [introPresentationStorageKey, assistantTurnCount]);

  // Clear stale party dialogue when switching chats (M7)
  const prevActiveChatRef = useRef(activeChatId);
  useEffect(() => {
    if (prevActiveChatRef.current === activeChatId) return; // skip initial mount
    prevActiveChatRef.current = activeChatId;
    setPartyDialogue([]);
    setPartyChatMessageId(null);
    setQueuedQte(null);
    setQueuedEncounter(null);
    setPendingEncounter(null);
    setCombatParty(null);
    setCombatEnemies(null);
    setNarrationDone(false);
    lastProcessedMsgRef.current = null;
    // Reset inventory/readables for the new chat
    setInventoryItems((chatMeta.gameInventory as Array<{ name: string; quantity: number }>) ?? []);
    setInventoryNotifications([]);
    setActiveReadable(null);
    readableQueueRef.current = [];
    // Allow the auto-tutorial to re-evaluate for the new chat (guard still gates on disabled flag)
    tutorialAutoTriggeredRef.current = false;
  }, [activeChatId, chatMeta.gameInventory]);

  const handleActiveSpeakerChange = useCallback(
    (speaker: { name: string; avatarUrl: string; expression?: string } | null) => {
      setActiveSpeaker(speaker);
    },
    [],
  );

  // Apply segment-tied effects when the user progresses to a new segment
  const handleSegmentEnter = useCallback(
    (segmentIndex: number) => {
      if (appliedSegmentsRef.current.has(segmentIndex)) return;
      const effects = pendingSegmentEffects.filter((e) => e.segment === segmentIndex);
      if (effects.length === 0) return;
      appliedSegmentsRef.current.add(segmentIndex);

      const assetMap = assetManifest?.assets ?? null;
      for (const fx of effects) {
        if (fx.background) {
          const resolved = resolveAssetTag(fx.background, "backgrounds", assetMap);
          useGameAssetStore.getState().setCurrentBackground(resolved);
        }
        if (fx.music) {
          const resolved = resolveAssetTag(fx.music, "music", assetMap);
          audioManager.playMusic(resolved, assetMap);
          useGameAssetStore.getState().setCurrentMusic(resolved);
        }
        if (fx.sfx?.length) {
          for (const sfx of fx.sfx) {
            const resolved = resolveAssetTag(sfx, "sfx", assetMap);
            audioManager.playSfx(resolved, assetMap);
          }
        }
        if (fx.ambient) {
          const resolved = resolveAssetTag(fx.ambient, "ambient", assetMap);
          audioManager.playAmbient(resolved, assetMap);
          useGameAssetStore.getState().setCurrentAmbient(resolved);
        }
        // Widget updates handled by GM model via inline [widget:] tags
      }
    },
    [pendingSegmentEffects, assetManifest],
  );

  // Fetch asset manifest on mount
  useEffect(() => {
    fetchManifest();
  }, [fetchManifest]);

  // Clean up audio + reset playback state when SWITCHING chats.
  // On unmount, only dispose audio (stop sounds) but keep store state intact so that
  // same-chat remount (e.g. returning from persona editor) can read it immediately
  // without waiting for the scene restore effect.
  const prevChatIdRef = useRef(activeChatId);
  useEffect(() => {
    if (prevChatIdRef.current !== activeChatId) {
      audioManager.dispose();
      useGameAssetStore.getState().resetPlaybackState();
      prevChatIdRef.current = activeChatId;
    }
    return () => {
      audioManager.dispose();
    };
  }, [activeChatId]);

  // Reconnect audio and background on mount if the store was disposed
  // (e.g. user left to home and returned to the same game).
  // Only reconnect for restored sessions — new games should not replay stale store state.
  useEffect(() => {
    if (!assetManifest || !isRestoredRef.current) return;
    const { currentMusic, currentAmbient, currentBackground: storeBg } = useGameAssetStore.getState();
    const assetMap = assetManifest.assets ?? null;
    // Restore background from metadata if the store was reset
    if (!storeBg) {
      const savedBg = chatMeta.gameSceneBackground as string | undefined;
      if (savedBg) {
        useGameAssetStore.getState().setCurrentBackground(savedBg);
      }
    }
    if (currentMusic && !audioManager.getState().musicTag) {
      audioManager.playMusic(currentMusic, assetMap);
    }
    if (currentAmbient && !audioManager.getState().ambientTag) {
      audioManager.playAmbient(currentAmbient, assetMap);
    }
  }, [assetManifest, chatMeta.gameSceneBackground]);

  // Fetch sprites for all characters in the game so dialogue avatars can show expression-specific images
  const characterIds = useMemo(() => [...characterMap.keys()], [characterMap]);

  // Also resolve persona sprite ID for expression lookup
  const personaSpriteId = useMemo(() => {
    const config = chatMeta.gameSetupConfig as Record<string, unknown> | undefined;
    return (config?.personaId as string | undefined) ?? null;
  }, [chatMeta.gameSetupConfig]);

  const spriteQueries = useQueries({
    queries: characterIds.map((id) => ({
      queryKey: spriteKeys.list(id),
      queryFn: () => api.get<SpriteInfo[]>(`/sprites/${id}`),
      enabled: !!id,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const personaSpriteQuery = useQuery({
    queryKey: spriteKeys.list(personaSpriteId ?? ""),
    queryFn: () => api.get<SpriteInfo[]>(`/sprites/${personaSpriteId}`),
    enabled: !!personaSpriteId,
    staleTime: 5 * 60 * 1000,
  });

  // Map: lowercase character name → SpriteInfo[]
  const spriteMap = useMemo(() => {
    const map = new Map<string, SpriteInfo[]>();
    characterIds.forEach((id, i) => {
      const data = spriteQueries[i]?.data;
      const charInfo = characterMap.get(id);
      if (data?.length && charInfo) {
        map.set(charInfo.name.toLowerCase(), data);
      }
    });
    // Add persona sprites if available
    if (personaInfo?.name && personaSpriteQuery.data?.length) {
      map.set(personaInfo.name.toLowerCase(), personaSpriteQuery.data);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterIds, characterMap, personaInfo, ...spriteQueries.map((q) => q.data), personaSpriteQuery.data]);

  // Build sprite expression map from activeSpeaker for SpriteOverlay
  const gameSpriteExpressions = useMemo(() => {
    if (!activeSpeaker?.expression) return undefined;
    const entry = [...characterMap.entries()].find(
      ([, c]) => c.name.toLowerCase() === activeSpeaker.name.toLowerCase(),
    );
    if (!entry) return undefined;
    return { [entry[0]]: activeSpeaker.expression };
  }, [activeSpeaker, characterMap]);

  // Only show the active speaker's sprite (not all party members at once)
  // Must have full-body sprites (full_ prefix) to appear
  const activeSpriteIds = useMemo(() => {
    if (!activeSpeaker) return [];
    const entry = [...characterMap.entries()].find(
      ([, c]) => c.name.toLowerCase() === activeSpeaker.name.toLowerCase(),
    );
    if (!entry) return [];
    const idx = characterIds.indexOf(entry[0]);
    const sprites = spriteQueries[idx]?.data;
    const hasFullBody = sprites?.some((s) => s.expression.toLowerCase().startsWith("full_"));
    return hasFullBody ? [entry[0]] : [];
  }, [activeSpeaker, characterMap, characterIds, spriteQueries]);

  // Keep previous sprite IDs around during fade-out so the component stays mounted
  const prevSpriteIdsRef = useRef<string[]>([]);
  const spriteVisible = activeSpriteIds.length > 0;
  const displaySpriteIds = spriteVisible ? activeSpriteIds : prevSpriteIdsRef.current;
  useEffect(() => {
    if (spriteVisible) prevSpriteIdsRef.current = activeSpriteIds;
  }, [spriteVisible, activeSpriteIds]);

  // New game mechanics hooks
  const _advanceTime = useAdvanceTime();
  const updateWeather = useUpdateWeather();
  const _rollEncounter = useRollEncounter();
  const _updateReputation = useUpdateReputation();
  const _journalEntry = useJournalEntry();
  const transitionGameState = useTransitionGameState();
  const sceneAnalysis = useSceneAnalysis();
  const sidecarConfig = useSidecarStore((s) => s.config);
  const sidecarReady = useSidecarStore((s) => s.inferenceReady);
  const sidecarStatus = useSidecarStore((s) => s.status);
  const sidecarStartupError = useSidecarStore((s) => s.startupError);
  const sidecarFailedRuntimeVariant = useSidecarStore((s) => s.failedRuntimeVariant);
  const openSidecarModal = useSidecarStore((s) => s.setShowDownloadModal);
  const refreshSidecarStatus = useSidecarStore((s) => s.fetchStatus);

  // Process GM tags from the latest assistant message
  const latestAssistantMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "assistant" || messages[i]!.role === "narrator") return messages[i];
    }
    return null;
  }, [messages]);

  // Keep latest assistant message in a ref so the Zustand subscription can read it
  const latestAssistantMsgRef = useRef(latestAssistantMsg);
  latestAssistantMsgRef.current = latestAssistantMsg;

  const latestNarrationText = useMemo(
    () => (latestAssistantMsg?.content ? parseGmTags(latestAssistantMsg.content).cleanContent.trim() : ""),
    [latestAssistantMsg?.content],
  );

  const hasCombatResultAfterMessage = useCallback(
    (messageId: string) => {
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex < 0) return false;
      for (let i = messageIndex + 1; i < messages.length; i++) {
        const msg = messages[i]!;
        if (msg.role === "user" && msg.content.includes("[combat_result]")) {
          return true;
        }
      }
      return false;
    },
    [messages],
  );

  const hasQteResponseAfterMessage = useCallback(
    (messageId: string) => {
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex < 0) return false;
      for (let i = messageIndex + 1; i < messages.length; i++) {
        const msg = messages[i]!;
        if (msg.role === "user" && msg.content.includes("[qte_bonus:")) {
          return true;
        }
      }
      return false;
    },
    [messages],
  );

  // ── Scene preparation gating ──
  // Track which message has had its scene effects prepared so narration
  // isn't displayed until backgrounds/music/etc. are ready.
  const sceneReadyMsgIdRef = useRef<string | undefined>(undefined);
  const applySceneResultRef = useRef<((result: import("@marinara-engine/shared").SceneAnalysis) => void) | null>(null);
  const [sceneReadyTick, setSceneReadyTick] = useState(0);
  void sceneReadyTick; // used only to trigger re-renders

  // On first render, mark existing messages as scene-ready (avoid false loading).
  // Only pre-seed sceneReadyMsgIdRef (narration gating) and weatherMsgRef.
  // NEVER pre-seed lastProcessedMsgRef here — let the processing effect decide.
  const isRestoredRef = useRef(false);

  // ── Restore scene assets (background/music/ambient) from chat metadata on page load ──
  const sceneRestoredRef = useRef(false);
  const partyDialogueRestoredRef = useRef(false);

  if (sceneReadyMsgIdRef.current === undefined && !isMessagesLoading) {
    if (latestAssistantMsg && !isStreaming) {
      // Returning to an existing game — mark scene as ready and skip weather/intro
      isRestoredRef.current = true;
      sceneReadyMsgIdRef.current = latestAssistantMsg.id;
      weatherMsgRef.current = latestAssistantMsg.id;
    } else {
      sceneReadyMsgIdRef.current = "__none__";
      weatherMsgRef.current = null;
    }
  }

  useEffect(() => {
    if (sceneRestoredRef.current || isMessagesLoading || !latestAssistantMsg?.content) return;
    // Wait for asset manifest before restoring audio (avoids invalid URI errors)
    if (!assetManifest) return;
    sceneRestoredRef.current = true;

    const savedBg = chatMeta.gameSceneBackground as string | undefined;
    const savedMusic = chatMeta.gameSceneMusic as string | undefined;
    const savedAmbient = chatMeta.gameSceneAmbient as string | undefined;
    const assetMap = assetManifest.assets ?? null;

    // Always overwrite from chatMeta (source of truth on mount) — handles both
    // same-chat remount (store may already match) and different-chat mount.
    useGameAssetStore.getState().setCurrentBackground(savedBg ?? null);

    if (savedMusic) {
      useGameAssetStore.getState().setCurrentMusic(savedMusic);
      // Play music — may be blocked by autoplay, audioManager queues retry on gesture
      if (audioManager.getState().musicTag !== savedMusic) {
        audioManager.playMusic(savedMusic, assetMap);
      }
    } else {
      useGameAssetStore.getState().setCurrentMusic(null);
    }

    if (savedAmbient) {
      useGameAssetStore.getState().setCurrentAmbient(savedAmbient);
      if (audioManager.getState().ambientTag !== savedAmbient) {
        audioManager.playAmbient(savedAmbient, assetMap);
      }
    } else {
      useGameAssetStore.getState().setCurrentAmbient(null);
    }

    // Re-extract interactive tags (choices, QTE, encounters) from the latest message
    // so they survive unmount/remount and page refresh.
    if (isRestoredRef.current) {
      const tags = parseGmTags(latestAssistantMsg.content);
      if (tags.choices) setActiveChoices(tags.choices);
      if (tags.qte && !hasQteResponseAfterMessage(latestAssistantMsg.id)) {
        setQueuedQte({ qte: tags.qte, messageId: latestAssistantMsg.id });
      }
      if (tags.combatEncounter && !hasCombatResultAfterMessage(latestAssistantMsg.id)) {
        setQueuedEncounter({ encounter: tags.combatEncounter, messageId: latestAssistantMsg.id });
      }
      lastProcessedMsgRef.current = latestAssistantMsg.id;
      // Clear restored flag so subsequent new messages are processed normally
      // by processScene (which skips when isRestoredRef.current is true).
      isRestoredRef.current = false;
    }
  }, [
    isMessagesLoading,
    latestAssistantMsg?.content,
    latestAssistantMsg?.id,
    assetManifest,
    chatMeta.gameSceneBackground,
    chatMeta.gameSceneMusic,
    chatMeta.gameSceneAmbient,
    hasQteResponseAfterMessage,
    hasCombatResultAfterMessage,
  ]);

  // ── Restore party dialogue from the last [party-chat] message on page load ──
  useEffect(() => {
    if (partyDialogueRestoredRef.current || isMessagesLoading) return;
    partyDialogueRestoredRef.current = true;
    // Find the last assistant message that contains [party-chat] content
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      if ((msg.role === "assistant" || msg.role === "narrator") && msg.content.startsWith("[party-chat]")) {
        const raw = msg.content.replace(/^\[party-chat\]\n?/, "");
        const lines = parsePartyDialogue(raw);
        if (lines.length > 0) {
          setPartyDialogue(lines);
          setPartyChatMessageId(msg.id);
        }
        break;
      }
    }
  }, [isMessagesLoading, messages]);

  // ── Persist scene assets to chat metadata (debounced) ──
  const scenePersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Subscribe to asset store changes and persist to chat metadata
    const unsub = useGameAssetStore.subscribe((state, prev) => {
      if (!sceneRestoredRef.current) return;
      if (
        state.currentBackground === prev.currentBackground &&
        state.currentMusic === prev.currentMusic &&
        state.currentAmbient === prev.currentAmbient
      )
        return;
      if (scenePersistTimer.current) clearTimeout(scenePersistTimer.current);
      scenePersistTimer.current = setTimeout(() => {
        const patch: Record<string, unknown> = {
          gameSceneBackground: state.currentBackground,
          gameSceneMusic: state.currentMusic,
          gameSceneAmbient: state.currentAmbient,
        };
        api.patch(`/chats/${activeChatId}/metadata`, patch).catch(() => {});
      }, 1500);
    });
    return () => {
      unsub();
      // Flush any pending scene persist immediately on unmount
      if (scenePersistTimer.current) {
        clearTimeout(scenePersistTimer.current);
        const { currentBackground, currentMusic, currentAmbient } = useGameAssetStore.getState();
        api
          .patch(`/chats/${activeChatId}/metadata`, {
            gameSceneBackground: currentBackground,
            gameSceneMusic: currentMusic,
            gameSceneAmbient: currentAmbient,
          })
          .catch(() => {});
      }
    };
  }, [activeChatId]);

  // ── Persist narration segment index (localStorage for instant reads + server for durability) ──
  const segmentStorageKey = `narration-idx:${activeChatId}`;
  const segmentPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSegmentChange = useCallback(
    (index: number) => {
      try {
        localStorage.setItem(segmentStorageKey, String(index));
      } catch {
        /* storage unavailable */
      }
      if (segmentPersistTimer.current) clearTimeout(segmentPersistTimer.current);
      segmentPersistTimer.current = setTimeout(() => {
        api.patch(`/chats/${activeChatId}/metadata`, { gameNarrationIndex: index }).catch(() => {});
      }, 500);
    },
    [activeChatId, segmentStorageKey],
  );
  useEffect(() => {
    return () => {
      // Flush any pending segment index persist immediately on unmount
      if (segmentPersistTimer.current) {
        clearTimeout(segmentPersistTimer.current);
        try {
          const saved = localStorage.getItem(segmentStorageKey);
          if (saved != null) {
            api.patch(`/chats/${activeChatId}/metadata`, { gameNarrationIndex: Number(saved) }).catch(() => {});
          }
        } catch {
          /* */
        }
      }
    };
  }, [activeChatId, segmentStorageKey]);

  // Read the saved narration index for restore — prefer localStorage (fast, survives
  // browser restarts) for instant restore, fall back to server metadata.
  const restoredSegmentIndex = useMemo(() => {
    try {
      const saved = localStorage.getItem(segmentStorageKey);
      if (saved != null) {
        const idx = Number(saved);
        if (Number.isFinite(idx) && idx >= 0) return idx;
      }
    } catch {
      /* storage unavailable */
    }
    // Fall back to server-persisted metadata (survives browser restarts)
    const serverIdx = chatMeta.gameNarrationIndex;
    if (typeof serverIdx === "number" && Number.isFinite(serverIdx) && serverIdx >= 0) return serverIdx;
    return 0;
  }, [segmentStorageKey, chatMeta.gameNarrationIndex]);

  // Check if async scene preparation exists (sidecar or connection-based scene model)
  const hasAsyncScenePrep = useMemo(() => {
    const useSidecar = sidecarConfig.useForGameScene && sidecarReady;
    const setupCfg = chatMeta.gameSetupConfig as Record<string, unknown> | null;
    const sceneConnId = (chatMeta.gameSceneConnectionId as string) || (setupCfg?.sceneConnectionId as string) || null;
    return useSidecar || !!sceneConnId;
  }, [sidecarConfig.useForGameScene, sidecarReady, chatMeta.gameSetupConfig, chatMeta.gameSceneConnectionId]);

  // True when latest message needs scene effects that haven't been applied yet
  const scenePreparing =
    hasAsyncScenePrep &&
    !isStreaming &&
    latestAssistantMsg != null &&
    sceneReadyMsgIdRef.current !== latestAssistantMsg.id &&
    !sceneAnalysisFailed;

  // Show retry/skip buttons only after being stuck for 15 seconds (avoid showing during normal processing)
  const sceneProcessed = latestAssistantMsg == null || sceneReadyMsgIdRef.current === latestAssistantMsg?.id;
  useEffect(() => {
    // Reset whenever scene processing completes or streaming starts
    if (sceneProcessed || isStreaming) {
      setSceneStuckVisible(false);
      return;
    }
    // Only start timer when content is present and streaming is done
    if (!latestAssistantMsg?.content) return;
    const timer = setTimeout(() => setSceneStuckVisible(true), 15_000);
    return () => clearTimeout(timer);
  }, [sceneProcessed, isStreaming, latestAssistantMsg?.content]);

  useEffect(() => {
    if (!latestAssistantMsg?.content || isStreaming) return;
    if (weatherMsgRef.current === latestAssistantMsg.id) return;
    weatherMsgRef.current = latestAssistantMsg.id;
    // Map game state to weather action for probabilistic change
    const action = gameState === "travel_rest" ? "travel" : gameState === "exploration" ? "explore" : "turn";
    updateWeather.mutate({ chatId: activeChatId, action, location: gameSnapshot?.location ?? "" });
  }, [
    latestAssistantMsg?.content,
    latestAssistantMsg?.id,
    isStreaming,
    activeChatId,
    updateWeather,
    gameState,
    gameSnapshot?.location,
  ]);

  // ── Scene processing: fires once when streaming ends for a new message ──
  // Uses a Zustand subscription to detect isStreaming going false, which is
  // immune to React effect timing / dependency issues.
  const processSceneRef = useRef<(() => void) | null>(null);

  // Keep the processing function fresh on every render so it captures current closure values
  processSceneRef.current = () => {
    // Read from ref, NOT closure — the Zustand subscription fires before React re-renders
    const msg = latestAssistantMsgRef.current;
    if (!msg?.content) {
      console.warn("[scene-process] No message content yet, skipping");
      return;
    }
    if (lastProcessedMsgRef.current === msg.id) return;
    if (isRestoredRef.current) {
      lastProcessedMsgRef.current = msg.id;
      return;
    }

    // Read asset manifest from store directly (not from dependency)
    const manifest = useGameAssetStore.getState().manifest;
    const assets = manifest?.assets ?? null;

    console.warn("[scene-process] FIRING for message:", msg.id, "| assets:", !!assets);
    lastProcessedMsgRef.current = msg.id;
    setNarrationDone(false);
    setSceneAnalysisFailed(false);
    setPartyDialogue([]);
    setPartyChatMessageId(null);
    setQueuedQte(null);
    setQueuedEncounter(null);
    setPendingSegmentEffects([]);
    appliedSegmentsRef.current = new Set();
    // Cancel any pending segment persist timer to prevent it from overwriting our reset
    if (segmentPersistTimer.current) {
      clearTimeout(segmentPersistTimer.current);
      segmentPersistTimer.current = null;
    }
    // Reset persisted narration index for new message
    try {
      sessionStorage.removeItem(`narration-idx:${activeChatId}`);
    } catch {
      /* ignore */
    }
    api.patch(`/chats/${activeChatId}/metadata`, { gameNarrationIndex: 0 }).catch(() => {});

    const tags = parseGmTags(msg.content);
    const useSidecar = sidecarConfig.useForGameScene && sidecarReady;
    const setupConfig = chatMeta.gameSetupConfig as Record<string, unknown> | null;
    const sceneConnId =
      (chatMeta.gameSceneConnectionId as string) || (setupConfig?.sceneConnectionId as string) || null;

    // Direction effects ALWAYS come from the main model (narratively timed)
    if (tags.directions.length > 0) {
      setActiveDirections(tags.directions);
    }

    // Combat encounters always from the main model
    if (tags.combatEncounter) {
      setQueuedEncounter({ encounter: tags.combatEncounter, messageId: msg.id });
    }

    // Skill checks from GM — resolve server-side
    if (tags.skillChecks.length > 0) {
      const sc = tags.skillChecks[0]!;
      skillCheck.mutate(
        {
          chatId: activeChatId,
          skill: sc.skill,
          dc: sc.dc,
          advantage: sc.advantage,
          disadvantage: sc.disadvantage,
        },
        {
          onSuccess: (res) => setPendingSkillCheck(res.result),
        },
      );
    }

    // Element attacks — show reaction popup for first element_attack tag
    if (tags.elementAttacks.length > 0) {
      const ea = tags.elementAttacks[0]!;
      setPendingReaction({
        reaction: `${ea.element.charAt(0).toUpperCase() + ea.element.slice(1)} Strike`,
        description: `An elemental ${ea.element} attack strikes ${ea.target}!`,
        damageMultiplier: 1,
        attackerName: "Player",
        defenderName: ea.target,
        element: ea.element,
      });
    }

    // QTE tags always from the main model
    if (tags.qte && !hasQteResponseAfterMessage(msg.id)) {
      setQueuedQte({ qte: tags.qte, messageId: msg.id });
    }

    // Scene wrap-up: handle bg, music, sfx, ambient, widgets, state changes
    // Widget updates always come from the GM model (not sidecar), apply them immediately
    for (const wu of tags.widgetUpdates) {
      applyWidgetUpdate(wu);
    }

    // State change tags always come from the GM model — transition via server so
    // the new state is validated, persisted to chatMeta (survives refetch/refresh),
    // and triggers side effects (combat checkpoint, OOC influence).
    if (tags.stateChange) {
      const next = tags.stateChange as import("@marinara-engine/shared").GameActiveState;
      // Optimistic local update so the map icon flips immediately
      useGameModeStore.getState().setGameState(next);
      transitionGameState.mutate({ chatId: activeChatId, newState: next });
    }

    // NPC reputation actions from inline [reputation:] tags
    if (tags.reputationActions.length > 0) {
      const repActions = tags.reputationActions.map((ra) => ({
        npcId: ra.npcName,
        action: ra.action,
      }));
      _updateReputation.mutate({ chatId: activeChatId, actions: repActions });
    }

    // Inventory updates — add/remove items and persist
    if (tags.inventoryUpdates.length > 0) {
      const notifications: string[] = [];
      setInventoryItems((prev) => {
        const updated = [...prev];
        for (const invUpdate of tags.inventoryUpdates) {
          for (const itemName of invUpdate.items) {
            if (invUpdate.action === "add") {
              const existing = updated.find((i) => i.name.toLowerCase() === itemName.toLowerCase());
              if (existing) {
                existing.quantity += 1;
              } else {
                updated.push({ name: itemName, quantity: 1 });
              }
              notifications.push(`You gained ${itemName}!`);
            } else {
              const idx = updated.findIndex((i) => i.name.toLowerCase() === itemName.toLowerCase());
              if (idx >= 0) {
                updated[idx]!.quantity -= 1;
                if (updated[idx]!.quantity <= 0) updated.splice(idx, 1);
                notifications.push(`You lost ${itemName}!`);
              }
            }
            // Journal: record inventory change
            api
              .post("/game/journal/entry", {
                chatId: activeChatId,
                type: "item",
                data: {
                  item: itemName,
                  action: invUpdate.action === "add" ? "acquired" : "lost",
                  quantity: 1,
                },
              })
              .catch(() => {});
          }
        }
        // Persist to chat metadata
        api.patch(`/chats/${activeChatId}/metadata`, { gameInventory: updated }).catch(() => {});
        return updated;
      });
      // Show notifications outside the updater to avoid setState-in-setState
      setInventoryNotifications(notifications);
      if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
      notificationTimerRef.current = setTimeout(() => setInventoryNotifications([]), 4000);
    }

    console.warn("[scene-wrapup] path:", useSidecar ? "sidecar" : sceneConnId ? "connection" : "inline-only");

    // Only send assets the LLM actually picks from: backgrounds (capped 50) and SFX (capped 50).
    // Music and ambient are handled by deterministic server-side scoring — not sent.
    const assetKeys = Object.keys(assets ?? {});
    const bgTags = sampleTags(
      assetKeys.filter((k) => k.startsWith("backgrounds:")),
      50,
    );
    const sfxTags = sampleTags(
      assetKeys.filter((k) => k.startsWith("sfx:")),
      50,
    );
    const charNames = [...new Set([...characterMap.values()].map((c) => c.name))];

    const sceneContext = {
      currentState: gameState,
      availableBackgrounds: bgTags,
      availableSfx: sfxTags,
      activeWidgets: hudWidgets,
      trackedNpcs: npcs,
      characterNames: charNames,
      currentBackground: currentBackground,
      currentMusic: useGameAssetStore.getState().currentMusic,
      currentAmbient: useGameAssetStore.getState().currentAmbient,
      currentWeather: gameSnapshot?.weather ?? null,
      currentTimeOfDay: gameSnapshot?.time ?? null,
    };

    // Clear any previous scene analysis timeout
    if (sceneAnalysisTimeoutRef.current) {
      clearTimeout(sceneAnalysisTimeoutRef.current);
      sceneAnalysisTimeoutRef.current = null;
    }

    const onComplete = () => {
      if (sceneAnalysisTimeoutRef.current) {
        clearTimeout(sceneAnalysisTimeoutRef.current);
        sceneAnalysisTimeoutRef.current = null;
      }
    };

    if (useSidecar) {
      sceneAnalysis.mutate(
        {
          narration: tags.cleanContent,
          context: sceneContext,
        },
        {
          onSuccess: (r) => {
            onComplete();
            applySceneResult(r, msg);
          },
          onError: () => {
            onComplete();
            setSceneAnalysisFailed(true);
            applyInlineTags(tags, assets, msg);
          },
        },
      );
    } else if (sceneConnId) {
      sceneAnalysis.mutate(
        {
          chatId: activeChatId,
          connectionId: sceneConnId || undefined,
          narration: tags.cleanContent,
          context: sceneContext,
        },
        {
          onSuccess: (r) => {
            onComplete();
            applySceneResult(r, msg);
          },
          onError: (err) => {
            onComplete();
            console.warn("[scene-wrapup] scene-wrap failed:", err);
            setSceneAnalysisFailed(true);
            applyInlineTags(tags, assets, msg);
          },
        },
      );
    } else {
      // No scene model at all: parse inline tags from the main model
      applyInlineTags(tags, assets, msg);
      return;
    }

    // Safety timeout: if neither onSuccess nor onError fires within 120s, auto-fail.
    // Generous because scene-wrap may still generate a background image inline.
    sceneAnalysisTimeoutRef.current = setTimeout(() => {
      sceneAnalysisTimeoutRef.current = null;
      if (sceneReadyMsgIdRef.current !== msg.id) {
        console.warn("[scene-wrapup] Scene analysis timed out after 120s, falling back to inline tags");
        setSceneAnalysisFailed(true);
        applyInlineTags(tags, assets, msg);
      }
    }, 120_000);
  };

  function applyInlineTags(gmTags: ReturnType<typeof parseGmTags>, assetMap: any, msg: { id: string }) {
    // Music is handled by the rule engine, not the GM's inline [music:] tag
    const musicTags = Object.keys(assetMap ?? {}).filter((k) => k.startsWith("music:"));
    const scoredMusic = scoreMusic({
      state: gameState,
      weather: gameSnapshot?.weather ?? null,
      timeOfDay: gameSnapshot?.time ?? null,
      currentMusic: useGameAssetStore.getState().currentMusic,
      availableMusic: musicTags,
    });
    if (scoredMusic) {
      audioManager.playMusic(scoredMusic, assetMap);
      useGameAssetStore.getState().setCurrentMusic(scoredMusic);
    }
    for (const sfx of gmTags.sfx) {
      const resolved = resolveAssetTag(sfx, "sfx", assetMap);
      audioManager.playSfx(resolved, assetMap);
    }
    // Ambient is handled by the rule engine, not the GM's inline [ambient:] tag
    const ambientTags = Object.keys(assetMap ?? {}).filter((k) => k.startsWith("ambient:"));
    const scoredAmbient = scoreAmbient({
      state: gameState,
      weather: gameSnapshot?.weather ?? null,
      timeOfDay: gameSnapshot?.time ?? null,
      currentAmbient: useGameAssetStore.getState().currentAmbient,
      availableAmbient: ambientTags,
      background: useGameAssetStore.getState().currentBackground,
    });
    if (scoredAmbient) {
      audioManager.playAmbient(scoredAmbient, assetMap);
      useGameAssetStore.getState().setCurrentAmbient(scoredAmbient);
    }
    if (gmTags.background) {
      const resolved = resolveAssetTag(gmTags.background, "backgrounds", assetMap);
      useGameAssetStore.getState().setCurrentBackground(resolved);
    } else if (!useGameAssetStore.getState().currentBackground) {
      const bgKeys = Object.keys(assetMap ?? {}).filter((k) => k.startsWith("backgrounds:"));
      if (bgKeys.length > 0) {
        const pick = bgKeys.find((k) => /town|village|forest|field|default|start/i.test(k)) ?? bgKeys[0]!;
        useGameAssetStore.getState().setCurrentBackground(pick);
      }
    }
    if (gmTags.choices) {
      setActiveChoices(gmTags.choices);
    }

    // Scene effects are applied — ungate narration
    sceneReadyMsgIdRef.current = msg.id;
    setSceneReadyTick((t) => t + 1);
    // Clear failed state since inline tags applied successfully as fallback
    setSceneAnalysisFailed(false);
  }

  function applySceneResult(result: import("@marinara-engine/shared").SceneAnalysis, msg: { id: string }) {
    console.log("[scene-analysis] Result from model:", JSON.stringify(result, null, 2));
    // NOTE: Game state transitions are owned exclusively by the GM model via [state: ...] tags.
    // The scene model no longer emits stateChange to avoid conflicting state flips.

    // Eagerly patch the game state snapshot so WeatherEffects renders immediately.
    // The mutations below also persist to DB, but may race with snapshot creation.
    // If no snapshot exists yet (first turn), create a minimal one.
    const currentGS = useGameStateStore.getState().current;
    if (result.weather || result.timeOfDay) {
      const base = currentGS ?? {
        id: "",
        chatId: activeChatId,
        messageId: "",
        swipeIndex: 0,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: [],
        recentEvents: [],
        playerStats: null,
        personaStats: null,
        createdAt: "",
      };
      useGameStateStore.getState().setGameState({
        ...base,
        ...(result.weather ? { weather: result.weather } : {}),
        ...(result.timeOfDay ? { time: result.timeOfDay } : {}),
      });
    }

    if (result.weather) {
      updateWeather.mutate({
        chatId: activeChatId,
        action: "set",
        type: result.weather,
        location: gameSnapshot?.location ?? "",
      });
    }
    if (result.timeOfDay) {
      _advanceTime.mutate({ chatId: activeChatId, action: result.timeOfDay });
    }
    if (result.reputationChanges?.length) {
      const repActions = result.reputationChanges.map((rc) => ({
        npcId: rc.npcName,
        action: rc.action,
      }));
      _updateReputation.mutate({ chatId: activeChatId, actions: repActions });
    }
    const assetMap = useGameAssetStore.getState().manifest?.assets ?? null;
    if (result.background) {
      const resolved = resolveAssetTag(result.background, "backgrounds", assetMap);
      useGameAssetStore.getState().setCurrentBackground(resolved);
    } else if (!useGameAssetStore.getState().currentBackground) {
      const bgKeys = Object.keys(assetMap ?? {}).filter((k) => k.startsWith("backgrounds:"));
      if (bgKeys.length > 0) {
        const pick = bgKeys.find((k) => /town|village|forest|field|default|start/i.test(k)) ?? bgKeys[0]!;
        useGameAssetStore.getState().setCurrentBackground(pick);
      }
    }
    if (result.music) {
      const resolved = resolveAssetTag(result.music, "music", assetMap);
      audioManager.playMusic(resolved, assetMap);
      useGameAssetStore.getState().setCurrentMusic(resolved);
    }
    if (result.ambient) {
      const resolved = resolveAssetTag(result.ambient, "ambient", assetMap);
      audioManager.playAmbient(resolved, assetMap);
      useGameAssetStore.getState().setCurrentAmbient(resolved);
    }

    if (result.segmentEffects?.length) {
      setPendingSegmentEffects(result.segmentEffects);
      appliedSegmentsRef.current = new Set();
      const seg0 = result.segmentEffects.filter((e) => e.segment === 0);
      if (seg0.length > 0) {
        appliedSegmentsRef.current.add(0);
        for (const fx of seg0) {
          if (fx.background) {
            const resolved = resolveAssetTag(fx.background, "backgrounds", assetMap);
            useGameAssetStore.getState().setCurrentBackground(resolved);
          }
          if (fx.sfx?.length)
            for (const s of fx.sfx) audioManager.playSfx(resolveAssetTag(s, "sfx", assetMap), assetMap);
        }
      }
    }

    const hasGeneratedBg =
      result.segmentEffects?.some((fx) => fx.background && fx.background.includes("generated-")) ||
      result.background?.includes("generated-");
    if (hasGeneratedBg) {
      fetchManifest();
    }
    if (result.generatedNpcAvatars?.length) {
      useGameModeStore.getState().patchNpcAvatars(result.generatedNpcAvatars);
    }

    const manifest = useGameAssetStore.getState().manifest;
    if (manifest) {
      const allBgTags = [
        result.background,
        ...(result.segmentEffects?.map((fx) => fx.background).filter(Boolean) ?? []),
      ].filter((t): t is string => !!t && t !== "black" && t !== "none");

      const unresolvedBg = allBgTags.find((t) => !manifest.assets[t]);
      // Pre-cache portraits for any tracked named NPC with a description, even if not
      // met yet — by the time the party encounters them their avatar is ready, and the
      // /generate-assets schema already caps this at 10 per turn so cost stays bounded.
      const npcsNeedingAvatars = npcs
        .filter((n) => !n.avatarUrl && n.description && n.name)
        .map((n) => ({ name: n.name, description: n.description }))
        .slice(0, 10);

      if (unresolvedBg || npcsNeedingAvatars.length > 0) {
        const assetPayload = {
          chatId: activeChatId,
          backgroundTag: unresolvedBg || undefined,
          npcsNeedingAvatars: npcsNeedingAvatars.length > 0 ? npcsNeedingAvatars : undefined,
        };
        setPendingAssetGeneration(assetPayload);
        setAssetGenerationFailed(false);
        api
          .post<{
            generatedBackground: string | null;
            generatedNpcAvatars: Array<{ name: string; avatarUrl: string }>;
          }>("/game/generate-assets", assetPayload)
          .then((res) => {
            setPendingAssetGeneration(null);
            if (res.generatedBackground) {
              fetchManifest().then(() => {
                useGameAssetStore.getState().setCurrentBackground(res.generatedBackground!);
              });
            }
            if (res.generatedNpcAvatars?.length) {
              useGameModeStore.getState().patchNpcAvatars(res.generatedNpcAvatars);
            }
            // Ungate narration after assets are ready
            sceneReadyMsgIdRef.current = msg.id;
            setSceneReadyTick((t) => t + 1);
          })
          .catch(() => {
            setAssetGenerationFailed(true);
            // Still ungate on failure so the user can interact
            sceneReadyMsgIdRef.current = msg.id;
            setSceneReadyTick((t) => t + 1);
          });
        // Don't fall through — narration stays gated until assets finish
        return;
      }
    }

    // Scene effects are applied — ungate narration (no pending assets)
    sceneReadyMsgIdRef.current = msg.id;
    setSceneReadyTick((t) => t + 1);
  }

  // Keep ref up-to-date so retry button can call it
  applySceneResultRef.current = (r) => applySceneResult(r, latestAssistantMsg!);

  /** Retry scene analysis: re-run the full processing pipeline for the current message. */
  const retrySceneAnalysis = useCallback(() => {
    const msg = latestAssistantMsgRef.current;
    if (!msg?.content) return;
    // Allow processScene to run for this message again
    lastProcessedMsgRef.current = null;
    processSceneRef.current?.();
  }, []);

  /** Skip scene analysis and fall back to inline GM tags only. */
  const skipSceneAnalysis = useCallback(() => {
    const msg = latestAssistantMsgRef.current;
    if (!msg?.content) return;
    const manifest = useGameAssetStore.getState().manifest;
    const tags = parseGmTags(msg.content);
    setSceneAnalysisFailed(false);
    applyInlineTags(tags, manifest?.assets ?? null, msg);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Retry failed image/NPC avatar generation. */
  const retryAssetGeneration = useCallback(() => {
    if (!pendingAssetGeneration) return;
    setAssetGenerationFailed(false);
    api
      .post<{
        generatedBackground: string | null;
        generatedNpcAvatars: Array<{ name: string; avatarUrl: string }>;
      }>("/game/generate-assets", pendingAssetGeneration)
      .then((res) => {
        setPendingAssetGeneration(null);
        if (res.generatedBackground) {
          fetchManifest().then(() => {
            useGameAssetStore.getState().setCurrentBackground(res.generatedBackground!);
          });
        }
        if (res.generatedNpcAvatars?.length) {
          useGameModeStore.getState().patchNpcAvatars(res.generatedNpcAvatars);
        }
      })
      .catch(() => {
        setAssetGenerationFailed(true);
      });
  }, [pendingAssetGeneration, fetchManifest]);

  // Listen for generation-complete DOM event dispatched by use-generate.ts.
  // This is more reliable than Zustand subscriptions which suffer from
  // subscribeWithSelector middleware timing issues + React 19 batching.
  useEffect(() => {
    const handler = (e: Event) => {
      const chatId = (e as CustomEvent).detail?.chatId;
      if (chatId !== activeChatId) return;
      console.warn("[scene-process] generation-complete event received for chat:", chatId);
      // Wait one animation frame so React commits the new messages → ref is fresh
      requestAnimationFrame(() => {
        const tryProcess = (attempt: number) => {
          const msg = latestAssistantMsgRef.current;
          if (msg?.content && lastProcessedMsgRef.current !== msg.id) {
            processSceneRef.current?.();
          } else if (attempt < 10) {
            setTimeout(() => tryProcess(attempt + 1), 200);
          } else {
            console.warn("[scene-process] Gave up waiting for message after generation-complete");
          }
        };
        tryProcess(0);
      });
    };
    window.addEventListener("marinara:generation-complete", handler);
    return () => window.removeEventListener("marinara:generation-complete", handler);
  }, [activeChatId]);

  // Listen for generation-error event to show retry button.
  useEffect(() => {
    const handler = (e: Event) => {
      const chatId = (e as CustomEvent).detail?.chatId;
      if (chatId !== activeChatId) return;
      setGenerationFailed(true);
    };
    window.addEventListener("marinara:generation-error", handler);
    return () => window.removeEventListener("marinara:generation-error", handler);
  }, [activeChatId]);

  // Clear generationFailed when a new generation starts (streaming begins).
  useEffect(() => {
    if (isStreaming) setGenerationFailed(false);
  }, [isStreaming]);

  // Play blueprint intro sequence only on first-ever load (not on re-navigation)
  useEffect(() => {
    if (introPlayedRef.current || !blueprint?.introSequence?.length) return;
    if (!latestAssistantMsg?.content) return;
    // Skip intro if this is a restored session (user returning to an existing game)
    if (isRestoredRef.current) {
      introPlayedRef.current = true;
      return;
    }
    introPlayedRef.current = true;
    setIntroCinematicActive(true);
    setActiveDirections(blueprint.introSequence);
  }, [blueprint, latestAssistantMsg?.content]);

  // Sync mute state
  useEffect(() => {
    audioManager.setMuted(audioMuted);
  }, [audioMuted]);

  // Message sending via generate hook
  const { generate, retryAgents } = useGenerate();

  const retryGeneration = useCallback(() => {
    setGenerationFailed(false);
    generate({ chatId: activeChatId, connectionId: null });
  }, [activeChatId, generate]);

  const sendMessage = useCallback(
    (message: string, attachments?: Array<{ type: string; data: string }>) => {
      if ((chatMeta.gameSessionStatus as string) === "concluded") return;
      generate({
        chatId: activeChatId,
        connectionId: null,
        userMessage: message,
        ...(attachments?.length ? { attachments } : {}),
      });
    },
    [activeChatId, chatMeta.gameSessionStatus, generate],
  );

  // Game mutations
  const createGame = useCreateGame();
  const gameSetup = useGameSetup();
  const startGame = useStartGame();
  const rollDice = useRollDice();
  const skillCheck = useSkillCheck();
  const moveOnMap = useMoveOnMap();
  const concludeSession = useConcludeSession();
  const startSession = useStartSession();
  const generateMap = useGenerateMap();
  const deleteChat = useDeleteChat();
  const updateChatMetadata = useUpdateChatMetadata();
  const startSessionLocked = startSession.isPending || startSessionRequested;

  // Party members from setup config
  const partyMembers = useMemo(() => {
    const config = chatMeta.gameSetupConfig as Record<string, unknown> | undefined;
    const ids = (config?.partyCharacterIds as string[]) ?? [];
    const baseMembers = ids
      .map((id) => {
        const c = characters.find((ch) => ch.id === id);
        if (!c) return null;
        const fromMap = characterMap.get(c.id);
        return {
          id: c.id,
          name: c.name,
          avatarUrl: c.avatarUrl ?? null,
          nameColor: fromMap?.nameColor,
          dialogueColor: fromMap?.dialogueColor,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      name: string;
      avatarUrl: string | null;
      nameColor?: string;
      dialogueColor?: string;
    }>;

    if (personaInfo?.name) {
      const configPersonaId = (config?.personaId as string | undefined) ?? null;
      const personaId = configPersonaId ? `persona:${configPersonaId}` : "persona:active";
      if (!baseMembers.some((m) => m.id === personaId)) {
        baseMembers.unshift({
          id: personaId,
          name: personaInfo.name,
          avatarUrl: personaInfo.avatarUrl ?? null,
          nameColor: personaInfo.nameColor,
          dialogueColor: personaInfo.dialogueColor,
        });
      }
    } else {
      // No persona selected — add a default "Player" entry
      if (!baseMembers.some((m) => m.id === "persona:default")) {
        baseMembers.unshift({
          id: "persona:default",
          name: "Player",
          avatarUrl: null,
        });
      }
    }

    return baseMembers;
  }, [chatMeta, characters, characterMap, personaInfo]);

  // Auto-open the in-game tutorial on the user's first game.
  // Guard: only when setup is complete, party is loaded, and the user
  // hasn't permanently disabled it. Fires once per chat mount.
  useEffect(() => {
    if (tutorialAutoTriggeredRef.current) return;
    if (gameTutorialDisabled) return;
    if (isSetupActive) return;
    if (partyMembers.length === 0) return;
    tutorialAutoTriggeredRef.current = true;
    // Small delay so the UI has time to mount/layout before the tooltip measures rects
    const t = window.setTimeout(() => setTutorialOpen(true), 600);
    return () => window.clearTimeout(t);
  }, [gameTutorialDisabled, isSetupActive, partyMembers.length]);

  const handleCloseTutorial = useCallback(() => {
    setTutorialOpen(false);
    // Mark as dismissed so it doesn't auto-open for future games.
    // The (?) help button will still re-open it on demand.
    setGameTutorialDisabled(true);
  }, [setGameTutorialDisabled]);

  const combatUiActive = gameState === "combat" && !!combatParty && !!combatEnemies;
  const travelRestOverlayOffsetClass = gameState === "travel_rest" ? "top-14" : "top-3";

  useEffect(() => {
    if (!queuedEncounter || !latestAssistantMsg?.id) return;
    if (queuedEncounter.messageId !== latestAssistantMsg.id) return;
    if (pendingEncounter || combatUiActive) return;
    if (isStreaming || scenePreparing || pendingAssetGeneration || directionsPlaying) return;
    if (latestNarrationText && !narrationDone) return;

    setPendingEncounter(queuedEncounter.encounter);
    setQueuedEncounter(null);
  }, [
    queuedEncounter,
    latestAssistantMsg?.id,
    pendingEncounter,
    combatUiActive,
    isStreaming,
    scenePreparing,
    pendingAssetGeneration,
    directionsPlaying,
    latestNarrationText,
    narrationDone,
  ]);

  useEffect(() => {
    if (!queuedQte || !latestAssistantMsg?.id) return;
    if (queuedQte.messageId !== latestAssistantMsg.id) return;
    if (activeQte) return;
    if (isStreaming || scenePreparing || pendingAssetGeneration || directionsPlaying) return;
    if (latestNarrationText && !narrationDone) return;

    setActiveQte(queuedQte.qte);
    setQueuedQte(null);
  }, [
    queuedQte,
    latestAssistantMsg?.id,
    activeQte,
    isStreaming,
    scenePreparing,
    pendingAssetGeneration,
    directionsPlaying,
    latestNarrationText,
    narrationDone,
  ]);

  // Build combat combatant arrays when a pending encounter arrives
  useEffect(() => {
    if (!pendingEncounter) return;
    const enc = pendingEncounter;
    setPendingEncounter(null);

    const enemyCombatants: Combatant[] = enc.enemies.map((e, i) => ({
      id: `enemy-${i}-${e.name.toLowerCase().replace(/\s+/g, "-")}`,
      name: e.name,
      hp: e.hp,
      maxHp: e.hp,
      attack: e.attack,
      defense: e.defense,
      speed: e.speed,
      level: e.level,
      side: "enemy" as const,
      element: e.element,
    }));
    setCombatEnemies(enemyCombatants);

    const partyCombatants: Combatant[] = partyMembers
      .filter((m) => !!m.id && !!m.name)
      .map((m) => {
        const snap = gameSnapshot?.presentCharacters?.find((pc) => pc.characterId === m.id);
        const stats = snap?.stats ?? [];
        const getStat = (name: string, fallback: number) => {
          const s = stats.find((st) => st.name.toLowerCase() === name.toLowerCase());
          return s ? s.value : fallback;
        };
        const pLevel = getStat("level", 5);
        return {
          id: m.id,
          name: m.name,
          hp: getStat("hp", 50 + pLevel * 10),
          maxHp: getStat("hp", 50 + pLevel * 10),
          mp: getStat("mp", 20 + pLevel * 3),
          maxMp: getStat("mp", 20 + pLevel * 3),
          attack: getStat("attack", 8 + pLevel * 2),
          defense: getStat("defense", 5 + pLevel),
          speed: getStat("speed", 5 + pLevel),
          level: pLevel,
          side: "player" as const,
          sprite: m.avatarUrl ?? undefined,
        };
      });

    if (partyCombatants.length === 0) {
      // partyMembers always includes at least a persona fallback, so this is defense-in-depth
      // for a future refactor. If we ever land here, abort cleanly and roll back to exploration
      // so the player isn't stranded in combat state with no UI.
      console.warn("[game] Combat aborted: party is empty or malformed.", { partyMembers });
      setCombatEnemies(null);
      useGameModeStore.getState().setGameState("exploration");
      if (activeChatId) {
        transitionGameState.mutate({ chatId: activeChatId, newState: "exploration" });
      }
      return;
    }

    setCombatParty(partyCombatants);
  }, [pendingEncounter, partyMembers, gameSnapshot, activeChatId, transitionGameState]);

  const partyCards = useMemo(() => {
    const cards: Record<
      string,
      {
        title: string;
        subtitle?: string;
        mood?: string;
        status?: string;
        level?: number;
        avatarUrl?: string | null;
        stats?: Array<{ name: string; value: number; max?: number; color?: string }>;
        inventory?: Array<{ name: string; quantity?: number; location?: string }>;
        customFields?: Record<string, string>;
        gameCard?: {
          shortDescription: string;
          class: string;
          abilities: string[];
          strengths: string[];
          weaknesses: string[];
          extra: Record<string, string>;
          rpgStats?: {
            attributes: Array<{ name: string; value: number }>;
            hp: { value: number; max: number };
          };
        };
      }
    > = {};

    // Game character cards from setup (keyed by name → card data)
    const gameCharCards = (chatMeta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];
    const gameCardByName = new Map<string, (typeof gameCharCards)[0]>();
    for (const gc of gameCharCards) {
      if (gc.name) gameCardByName.set((gc.name as string).toLowerCase(), gc);
    }

    // Build base cards from character data — name and avatar only.
    // Subtitle, status, stats, etc. come exclusively from the game snapshot.
    const config = chatMeta.gameSetupConfig as Record<string, unknown> | undefined;
    const partyIds = (config?.partyCharacterIds as string[]) ?? [];
    for (const charId of partyIds) {
      const c = characters.find((ch) => ch.id === charId);
      if (!c) continue;
      const gc = gameCardByName.get(c.name.toLowerCase());
      cards[charId] = {
        title: c.name,
        avatarUrl: c.avatarUrl ?? null,
        level: sessionNumber,
        gameCard: gc
          ? {
              shortDescription: (gc.shortDescription as string) || "",
              class: (gc.class as string) || "",
              abilities: (gc.abilities as string[]) || [],
              strengths: (gc.strengths as string[]) || [],
              weaknesses: (gc.weaknesses as string[]) || [],
              extra: (gc.extra as Record<string, string>) || {},
              rpgStats: gc.rpgStats as
                | { attributes: Array<{ name: string; value: number }>; hp: { value: number; max: number } }
                | undefined,
            }
          : undefined,
      };
    }

    // Overlay game-state data from snapshot (stats, mood, etc.)
    const presentCharacters = gameSnapshot?.presentCharacters ?? [];
    for (const pc of presentCharacters) {
      const existing = cards[pc.characterId];
      cards[pc.characterId] = {
        ...existing,
        title: pc.name || existing?.title || "Unknown",
        subtitle: pc.outfit || pc.appearance || existing?.subtitle || undefined,
        mood: pc.mood || existing?.mood || undefined,
        status: pc.thoughts || existing?.status || undefined,
        avatarUrl: pc.avatarPath || existing?.avatarUrl || null,
        stats:
          (pc.stats ?? []).length > 0
            ? (pc.stats ?? []).map((s) => ({ name: s.name, value: s.value, max: s.max, color: s.color }))
            : existing?.stats,
        customFields: pc.customFields || existing?.customFields,
        gameCard: existing?.gameCard,
      };
    }

    // Player persona card
    if (personaInfo?.name) {
      const configPersonaId = (config?.personaId as string | undefined) ?? null;
      const personaId = configPersonaId ? `persona:${configPersonaId}` : "persona:active";
      const gc = gameCardByName.get(personaInfo.name.toLowerCase());
      cards[personaId] = {
        title: personaInfo.name,
        subtitle: "Player Character",
        avatarUrl: personaInfo.avatarUrl ?? null,
        level: sessionNumber,
        status: gameSnapshot?.playerStats?.status || undefined,
        stats: [
          ...(gameSnapshot?.personaStats ?? []).map((s) => ({
            name: s.name,
            value: s.value,
            max: s.max,
            color: s.color,
          })),
          ...(gameSnapshot?.playerStats?.stats ?? []).map((s) => ({
            name: s.name,
            value: s.value,
            max: s.max,
            color: s.color,
          })),
        ],
        inventory: (gameSnapshot?.playerStats?.inventory ?? []).map((item) => ({
          name: item.name,
          quantity: item.quantity,
          location: item.location,
        })),
        gameCard: gc
          ? {
              shortDescription: (gc.shortDescription as string) || "",
              class: (gc.class as string) || "",
              abilities: (gc.abilities as string[]) || [],
              strengths: (gc.strengths as string[]) || [],
              weaknesses: (gc.weaknesses as string[]) || [],
              extra: (gc.extra as Record<string, string>) || {},
              rpgStats: gc.rpgStats as
                | { attributes: Array<{ name: string; value: number }>; hp: { value: number; max: number } }
                | undefined,
            }
          : undefined,
      };
    } else {
      // No persona selected — default player card
      cards["persona:default"] = {
        title: "Player",
        subtitle: "Player Character",
        avatarUrl: null,
        level: sessionNumber,
        status: gameSnapshot?.playerStats?.status || undefined,
        stats: [
          ...(gameSnapshot?.personaStats ?? []).map((s) => ({
            name: s.name,
            value: s.value,
            max: s.max,
            color: s.color,
          })),
          ...(gameSnapshot?.playerStats?.stats ?? []).map((s) => ({
            name: s.name,
            value: s.value,
            max: s.max,
            color: s.color,
          })),
        ],
        inventory: (gameSnapshot?.playerStats?.inventory ?? []).map((item) => ({
          name: item.name,
          quantity: item.quantity,
          location: item.location,
        })),
      };
    }

    return cards;
  }, [chatMeta.gameSetupConfig, chatMeta.gameCharacterCards, gameSnapshot, personaInfo, characters, sessionNumber]);

  const handleSaveCharacterSheet = useCallback(
    async (cardTitle: string, gameCard: GameCharacterSheetGameCard | undefined) => {
      if (!activeChatId) return;

      const normalizedTitle = cardTitle.trim();
      if (!normalizedTitle) return;

      const currentCards = (chatMeta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];
      const currentIndex = currentCards.findIndex(
        (entry) => typeof entry.name === "string" && entry.name.toLowerCase() === normalizedTitle.toLowerCase(),
      );

      const sanitizedGameCard = gameCard
        ? {
            name: normalizedTitle,
            shortDescription: gameCard.shortDescription.trim(),
            class: gameCard.class.trim(),
            abilities: gameCard.abilities.map((value: string) => value.trim()).filter(Boolean),
            strengths: gameCard.strengths.map((value: string) => value.trim()).filter(Boolean),
            weaknesses: gameCard.weaknesses.map((value: string) => value.trim()).filter(Boolean),
            extra: Object.fromEntries(
              Object.entries(gameCard.extra as Record<string, string>)
                .map(([key, value]) => [key.trim(), String(value).trim()] as const)
                .filter(([key, value]) => key && value),
            ),
            ...(gameCard.rpgStats
              ? {
                  rpgStats: {
                    attributes: gameCard.rpgStats.attributes
                      .map((attr: { name: string; value: number }) => ({
                        name: attr.name.trim(),
                        value: Number(attr.value) || 0,
                      }))
                      .filter((attr: { name: string; value: number }) => attr.name),
                    hp: {
                      value: Math.max(0, Number(gameCard.rpgStats.hp.value) || 0),
                      max: Math.max(1, Number(gameCard.rpgStats.hp.max) || 1),
                    },
                  },
                }
              : {}),
          }
        : null;

      const updatedCards = [...currentCards];
      if (sanitizedGameCard) {
        if (currentIndex >= 0) {
          updatedCards[currentIndex] = sanitizedGameCard;
        } else {
          updatedCards.push(sanitizedGameCard);
        }
      } else if (currentIndex >= 0) {
        updatedCards.splice(currentIndex, 1);
      } else {
        return;
      }

      try {
        await updateChatMetadata.mutateAsync({ id: activeChatId, gameCharacterCards: updatedCards });
        toast.success(`${normalizedTitle} sheet updated.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save character sheet.");
        throw error;
      }
    },
    [activeChatId, chatMeta.gameCharacterCards, updateChatMetadata],
  );

  // Map narration messages with character names
  const narrationMessages = useMemo(
    () =>
      messages.map((m) => ({
        ...m,
        characterName: m.characterId ? characterMap.get(m.characterId)?.name : undefined,
      })),
    [messages, characterMap],
  );

  const sessionStatus = (chatMeta.gameSessionStatus as string) || "active";
  const sessionInteractive = sessionStatus !== "concluded";
  const gameId = (chatMeta.gameId as string) || null;
  const sessionSummaries = (chatMeta.gamePreviousSessionSummaries as SessionSummary[]) || [];
  const displaySessionNumber =
    sessionStatus === "concluded" ? Math.max(sessionSummaries.length, 1) : sessionSummaries.length + 1;

  const handleRollDice = useCallback(
    (notation: string) => {
      rollDice.mutate({ chatId: activeChatId, notation });
    },
    [activeChatId, rollDice],
  );

  const handleDismissDice = useCallback(() => {
    setDiceRollResult(null);
  }, [setDiceRollResult]);

  const handleChoiceSelect = useCallback(
    (choice: string) => {
      if (!sessionInteractive) return;
      setActiveChoices(null);
      sendMessage(choice);
    },
    [sendMessage, sessionInteractive],
  );

  const handleGenerateMap = useCallback(() => {
    const locationType = gameSnapshot?.location?.trim() || "current location";
    const context = [
      `Location: ${gameSnapshot?.location ?? "Unknown"}`,
      gameSnapshot?.time ? `Time: ${gameSnapshot.time}` : null,
      gameSnapshot?.weather ? `Weather: ${gameSnapshot.weather}` : null,
      latestNarrationText ? `Scene: ${latestNarrationText}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    generateMap.mutate({
      chatId: activeChatId,
      locationType,
      context: context || locationType,
    });
  }, [
    activeChatId,
    gameSnapshot?.location,
    gameSnapshot?.time,
    gameSnapshot?.weather,
    generateMap,
    latestNarrationText,
  ]);

  const isSameMapPosition = useCallback(
    (left: { x: number; y: number } | string | null | undefined, right: { x: number; y: number } | string) => {
      if (!left) return false;
      if (typeof left === "string" || typeof right === "string") {
        return typeof left === "string" && typeof right === "string" && left === right;
      }
      return left.x === right.x && left.y === right.y;
    },
    [],
  );

  const describeMapPosition = useCallback(
    (position: { x: number; y: number } | string) => {
      if (typeof position === "string") {
        return currentMap?.nodes?.find((node) => node.id === position)?.label ?? position;
      }
      return (
        currentMap?.cells?.find((cell) => cell.x === position.x && cell.y === position.y)?.label ??
        `(${position.x}, ${position.y})`
      );
    },
    [currentMap],
  );

  const handleMapMove = useCallback(
    (position: { x: number; y: number } | string) => {
      if (!sessionInteractive) {
        setPendingMapMove(null);
        return;
      }
      if (isSameMapPosition(currentMap?.partyPosition, position)) {
        setPendingMapMove(null);
        return;
      }
      setPendingMapMove({ position, label: describeMapPosition(position) });
    },
    [currentMap?.partyPosition, describeMapPosition, isSameMapPosition, sessionInteractive],
  );

  const handleSendGameTurn = useCallback(
    (
      message: string,
      attachments?: Array<{ type: string; data: string }>,
      options?: { commitPendingMove?: boolean },
    ) => {
      if (!sessionInteractive) return;
      if (options?.commitPendingMove && pendingMapMove) {
        moveOnMap.mutate({ chatId: activeChatId, position: pendingMapMove.position });
      }
      sendMessage(message, attachments);
      if (options?.commitPendingMove && pendingMapMove) {
        setPendingMapMove(null);
      }
    },
    [activeChatId, moveOnMap, pendingMapMove, sendMessage, sessionInteractive],
  );

  useEffect(() => {
    setPendingMapMove(null);
  }, [activeChatId]);

  useEffect(() => {
    if (sessionInteractive) return;
    setPendingMapMove(null);
    setActiveChoices(null);
    setActiveQte(null);
    setQueuedQte(null);
  }, [sessionInteractive]);

  useEffect(() => {
    if (!pendingMapMove) return;
    if (isSameMapPosition(currentMap?.partyPosition, pendingMapMove.position)) {
      setPendingMapMove(null);
    }
  }, [currentMap?.partyPosition, isSameMapPosition, pendingMapMove]);

  const handleConcludeSession = useCallback(() => {
    concludeSession.mutate({ chatId: activeChatId });
  }, [activeChatId, concludeSession]);

  const handleRequestEndSession = useCallback(() => {
    setConfirmEndSessionOpen(true);
  }, []);

  const handleConfirmEndSession = useCallback(() => {
    handleConcludeSession();
    setConfirmEndSessionOpen(false);
  }, [handleConcludeSession]);

  const handleStartNewSession = useCallback(() => {
    if (!gameId || startSessionLocked || startSessionGuardRef.current) return;
    startSessionGuardRef.current = true;
    setStartSessionRequested(true);
    startSession.mutate(
      { gameId },
      {
        onSettled: () => {
          startSessionGuardRef.current = false;
          setStartSessionRequested(false);
        },
      },
    );
  }, [gameId, startSession, startSessionLocked]);

  const handleQteSelect = useCallback(
    (action: string, timeRemaining: number) => {
      if (!sessionInteractive) return;
      setActiveQte(null);
      const bonus = Math.ceil(timeRemaining);
      sendMessage(`*${action}* [qte_bonus: ${bonus}]`);
    },
    [sendMessage, sessionInteractive],
  );

  const handleQteTimeout = useCallback(() => {
    if (!sessionInteractive) return;
    setActiveQte(null);
    sendMessage("*hesitates too long* [qte_bonus: 0]");
  }, [sendMessage, sessionInteractive]);

  // Combat end handler — clear combat state and notify GM
  const handleCombatEnd = useCallback(
    (outcome: "victory" | "defeat" | "flee", summary: CombatSummary) => {
      setCombatParty(null);
      setCombatEnemies(null);

      // Flip the server-side + local game state back to exploration immediately.
      // (The [state: exploration] tag in the user message below is a hint for the GM's
      // next turn, but doesn't itself flip the authoritative state.)
      useGameModeStore.getState().setGameState("exploration");
      if (activeChatId) {
        transitionGameState.mutate({ chatId: activeChatId, newState: "exploration" });
      }

      // Build a compact, model-friendly recap so the GM can narrate the aftermath.
      const defeatedEnemies = summary.enemies.filter((e) => e.defeated).map((e) => e.name);
      const survivingEnemies = summary.enemies.filter((e) => !e.defeated);
      const partyStatus = summary.party.map((p) => {
        const hpPct = p.maxHp > 0 ? Math.round((p.hp / p.maxHp) * 100) : 0;
        const effects = p.statusEffects.length > 0 ? ` [${p.statusEffects.join(", ")}]` : "";
        const ko = p.ko ? " KO" : "";
        return `${p.name}: ${p.hp}/${p.maxHp} HP (${hpPct}%)${effects}${ko}`;
      });
      const lootText =
        summary.loot && summary.loot.length > 0
          ? summary.loot.map((l) => (l.quantity && l.quantity > 1 ? `${l.name} ×${l.quantity}` : l.name)).join(", ")
          : "";

      // Flee on round 1 means no round actually resolved — phrase it accordingly.
      const roundsPhrase =
        outcome === "flee" && summary.rounds <= 1
          ? "before combat began"
          : `after ${summary.rounds} round${summary.rounds === 1 ? "" : "s"}`;

      const recapLines: string[] = [];
      recapLines.push(`OUTCOME: ${outcome.toUpperCase()} (${roundsPhrase})`);
      if (defeatedEnemies.length > 0) recapLines.push(`Defeated: ${defeatedEnemies.join(", ")}`);
      if (survivingEnemies.length > 0) {
        recapLines.push(`Survived: ${survivingEnemies.map((e) => `${e.name} (${e.hp}/${e.maxHp} HP)`).join(", ")}`);
      }
      recapLines.push(`Party: ${partyStatus.join("; ")}`);
      if (lootText) recapLines.push(`Loot: ${lootText}`);

      const recap = recapLines.join("\n");
      let prefix: string;
      if (outcome === "victory") prefix = "*The battle is won.*";
      else if (outcome === "defeat") prefix = "*The party has been defeated...*";
      else prefix = "*The party flees from battle!*";

      // Wrap the recap in a clearly-labelled block so the GM treats it as canonical combat
      // context (the core prompt rule teaches how to narrate it). The block is stripped from
      // the user-visible bubble by stripGmTags / stripGmTagsKeepReadables, leaving only the
      // cosmetic italic prefix. State is flipped above via transitionGameState so no
      // [state:] tag is needed here.
      sendMessage(`${prefix}\n\n[combat_result]\n${recap}\n[/combat_result]`);

      // Journal: record combat outcome. The server's addCombatEntry only persists
      // (description, outcome) into JournalEntry.content, so fold the structured recap
      // into the description itself to preserve rounds / party / loot for players.
      const journalDescLines: string[] = [];
      if (outcome === "victory") journalDescLines.push(`Victory (${roundsPhrase})`);
      else if (outcome === "defeat") journalDescLines.push(`The party was defeated (${roundsPhrase})`);
      else journalDescLines.push(`The party fled from battle (${roundsPhrase})`);
      if (defeatedEnemies.length > 0) journalDescLines.push(`Defeated: ${defeatedEnemies.join(", ")}`);
      journalDescLines.push(`Party status: ${partyStatus.join("; ")}`);
      if (lootText) journalDescLines.push(`Loot: ${lootText}`);

      api
        .post("/game/journal/entry", {
          chatId: activeChatId,
          type: "combat",
          data: {
            description: journalDescLines.join(" — "),
            outcome: outcome === "flee" ? "fled" : outcome,
          },
        })
        .catch(() => {});
    },
    [sendMessage, activeChatId, transitionGameState],
  );

  // Toggle audio mute
  const handleToggleMute = useCallback(() => {
    useGameAssetStore.getState().setAudioMuted(!audioMuted);
  }, [audioMuted]);

  // Handle volume change from slider (0–100)
  const handleVolumeChange = useCallback(
    (value: number) => {
      setMasterVolume(value);
      const v = value / 100;
      audioManager.setVolumes(v * 0.6, v * 0.8, v * 0.5); // scale: music 60%, sfx 80%, ambient 50% of master
      if (value === 0 && !audioMuted) {
        useGameAssetStore.getState().setAudioMuted(true);
      } else if (value > 0 && audioMuted) {
        useGameAssetStore.getState().setAudioMuted(false);
      }
    },
    [audioMuted],
  );

  // Close volume popover on outside click
  useEffect(() => {
    if (!volumePopoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (volumePopoverRef.current && !volumePopoverRef.current.contains(e.target as Node)) {
        setVolumePopoverOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [volumePopoverOpen]);

  // Retry scene analysis for the latest message
  const handleRetryScene = useCallback(() => {
    if (!latestAssistantMsg?.content) return;
    const onSuccess = applySceneResultRef.current;
    if (!onSuccess) return;

    // Reset segment state so fresh effects can apply
    setPendingSegmentEffects([]);
    appliedSegmentsRef.current = new Set();

    const tags = parseGmTags(latestAssistantMsg.content);
    const assets = assetManifest?.assets ?? null;
    const assetKeys = Object.keys(assets ?? {});
    const bgTags = sampleTags(
      assetKeys.filter((k) => k.startsWith("backgrounds:")),
      50,
    );
    const sfxTags = sampleTags(
      assetKeys.filter((k) => k.startsWith("sfx:")),
      50,
    );
    const charNames = [...new Set([...characterMap.values()].map((c) => c.name))];
    const setupConfig = chatMeta.gameSetupConfig as Record<string, unknown> | null;
    const sceneConnId =
      (chatMeta.gameSceneConnectionId as string) || (setupConfig?.sceneConnectionId as string) || null;

    const context = {
      currentState: gameState,
      availableBackgrounds: bgTags,
      availableSfx: sfxTags,
      activeWidgets: hudWidgets,
      trackedNpcs: npcs,
      characterNames: charNames,
      currentBackground: currentBackground,
      currentMusic: useGameAssetStore.getState().currentMusic,
      currentAmbient: useGameAssetStore.getState().currentAmbient,
      currentWeather: gameSnapshot?.weather ?? null,
      currentTimeOfDay: gameSnapshot?.time ?? null,
    };

    if (sceneConnId) {
      sceneAnalysis.mutate(
        { chatId: activeChatId, connectionId: sceneConnId, narration: tags.cleanContent, context },
        { onSuccess, onError: (err) => console.error("[retry-scene] Failed:", err) },
      );
    } else {
      sceneAnalysis.mutate(
        { narration: tags.cleanContent, context },
        { onSuccess, onError: (err) => console.error("[retry-scene] Failed:", err) },
      );
    }
  }, [
    latestAssistantMsg,
    assetManifest,
    characterMap,
    gameState,
    hudWidgets,
    npcs,
    currentBackground,
    gameSnapshot,
    chatMeta,
    activeChatId,
    sceneAnalysis,
  ]);

  // Remap legacy hud_bottom widgets to left/right (hud_bottom was removed)
  const normalizedWidgets = useMemo(() => {
    let leftCount = 0;
    return hudWidgets.map((w) => {
      if ((w.position as string) === "hud_bottom") {
        const side = leftCount % 2 === 0 ? "hud_left" : "hud_right";
        leftCount++;
        return { ...w, position: side } as typeof w;
      }
      return w;
    });
  }, [hudWidgets]);

  // Resolve background image URL — supports exact tag match, partial/fuzzy match, and "black" override
  const resolvedBackground = useMemo(() => {
    if (currentBackground && assetManifest?.assets) {
      // Special value: "black" means no background (e.g. character waking up)
      if (currentBackground === "black" || currentBackground === "none") {
        return "black";
      }
      // 1. Exact tag match
      let entry = assetManifest.assets[currentBackground];
      // 2. Fuzzy match: try to find a tag that ends with or contains the given value
      if (!entry) {
        const lowerTag = currentBackground.toLowerCase();
        const keys = Object.keys(assetManifest.assets);
        // Try suffix match first (e.g. "forest-night" matches "backgrounds:fantasy:forest-night")
        const suffixMatch = keys.find((k) => k.toLowerCase().endsWith(`:${lowerTag}`) || k.toLowerCase() === lowerTag);
        if (suffixMatch) entry = assetManifest.assets[suffixMatch];
        // Try contains match (e.g. "forest" matches "backgrounds:fantasy:forest-night")
        if (!entry) {
          const containsMatch = keys.find((k) => k.startsWith("backgrounds:") && k.toLowerCase().includes(lowerTag));
          if (containsMatch) entry = assetManifest.assets[containsMatch];
        }
      }
      if (entry) {
        if (entry.path.startsWith("__user_bg__/")) {
          const filename = entry.path.replace("__user_bg__/", "");
          return `/api/backgrounds/file/${encodeURIComponent(filename)}`;
        }
        return `/api/game-assets/file/${entry.path}`;
      }
      console.warn("[bg-resolve] No asset match for background tag:", currentBackground);
    }
    // In game mode, do NOT fall back to the roleplay chat background — use black instead
    return undefined;
  }, [currentBackground, assetManifest]);

  // ONLY gate on the first turn — once any assistant content has been received,
  // the game is in-progress and the "adventure begins" screen should never reappear.
  const hasEverHadContent = useMemo(
    () => messages.some((m) => (m.role === "assistant" || m.role === "narrator") && m.content),
    [messages],
  );

  // Does this chat need initial game creation?
  const needsCreation = !chatMeta.gameId;

  // While messages are still loading for an existing active game, show a loading
  // indicator instead of flashing the setup/start screens.
  if (isMessagesLoading && !needsCreation && sessionStatus !== "setup" && !isSetupActive) {
    return (
      <div className="flex h-full items-center justify-center bg-black/80">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
      </div>
    );
  }

  // Setup wizard — show when explicitly active, when game needs creation, or when status is still "setup" (e.g. previous setup failed)
  if (isSetupActive || needsCreation || sessionStatus === "setup") {
    return (
      <GameSetupWizard
        onComplete={(config, preferences, conns, wizardGameName) => {
          if (needsCreation) {
            // Create game structure first, then run setup
            createGame.mutate(
              {
                name: wizardGameName || chat?.name || "New Game",
                setupConfig: config,
                chatId: activeChatId,
                connectionId: conns.gmConnectionId,
                characterConnectionId: conns.characterConnectionId,
              },
              {
                onSuccess: (res) => {
                  gameSetup.mutate({
                    chatId: res.sessionChat.id,
                    connectionId: conns.gmConnectionId,
                    preferences,
                  });
                },
              },
            );
          } else {
            gameSetup.mutate({ chatId: activeChatId, connectionId: conns.gmConnectionId, preferences });
          }
        }}
        onCancel={() => {
          if (needsCreation || sessionStatus === "setup") {
            // Delete the broken/empty game chat
            useChatStore.getState().setActiveChatId(null);
            deleteChat.mutate(activeChatId);
          }
          useGameModeStore.getState().setSetupActive(false);
        }}
        isLoading={createGame.isPending || gameSetup.isPending}
        characters={characters}
      />
    );
  }

  // World is built but the game hasn't started yet -- show "Start Game" screen.
  // Keep it visible until: (1) assistant content exists, (2) streaming is done,
  // (3) scene preparation (sidecar / connection scene model) has finished,
  // (4) any in-flight image / NPC portrait generation has completed.
  // Once ALL conditions are met for the first time the screen never returns.
  // sceneProcessed is computed above (near scenePreparing).
  const firstTurnFullyReady = hasEverHadContent && !isStreaming && sceneProcessed && !pendingAssetGeneration;
  const sidecarStartupFailed = sidecarConfig.useForGameScene && sidecarStatus === "server_error" && !sidecarReady;
  // Don't auto-dismiss: wait for user to click Continue after typewriter finishes.

  const awaitingFirstTurn = sessionStatus === "active" && !introPresented;
  if ((sessionStatus === "ready" && !introPresented) || startGame.isPending || awaitingFirstTurn) {
    const worldOverview = (chatMeta.gameWorldOverview as string) || null;
    const setupConfig = chatMeta.gameSetupConfig as Record<string, unknown> | undefined;
    // Phase: "idle" = show Start button over overview, "intro" = typewriter reveal after clicking Start
    const introPhase = startGame.isPending || awaitingFirstTurn ? "intro" : "idle";
    return (
      <div className="flex h-full items-center justify-center overflow-hidden bg-black/80 p-6">
        <div className="flex max-h-full max-w-lg flex-col items-center gap-6 text-center">
          {/* Genre / Setting tag */}
          {setupConfig && (
            <div className="flex flex-shrink-0 flex-wrap items-center justify-center gap-2 text-xs text-white/40">
              <span>{setupConfig.genre as string}</span>
              <span className="text-white/20">|</span>
              <span>{setupConfig.setting as string}</span>
              <span className="text-white/20">|</span>
              <span>{setupConfig.tone as string}</span>
            </div>
          )}

          {/* World overview — only revealed via typewriter after pressing Start Game */}
          {worldOverview && introPhase === "intro" && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <IntroTypewriter text={worldOverview} onComplete={() => setIntroTypewriterDone(true)} />
            </div>
          )}

          {/* Start button or generating indicator */}
          <div className="flex-shrink-0">
            {introPhase === "intro" ? (
              <div className="flex flex-col items-center gap-3">
                {firstTurnFullyReady && introTypewriterDone ? (
                  <button
                    onClick={() => {
                      setIntroPresented(true);
                      try {
                        localStorage.setItem(introPresentationStorageKey, "1");
                      } catch {
                        /* storage unavailable */
                      }
                      setIntroTypewriterDone(false);
                      // Retry any autoplay-blocked audio now that we have a user gesture
                      audioManager.retryPending();
                    }}
                    className="group flex items-center gap-2 rounded-xl bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-white transition-all hover:scale-105 hover:shadow-lg hover:shadow-[var(--primary)]/30"
                  >
                    Continue
                  </button>
                ) : (
                  <>
                    <div className="flex items-center gap-3 text-sm text-white/60">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                      <span>
                        {hasEverHadContent && !sceneProcessed
                          ? "Preparing the scene..."
                          : hasEverHadContent && pendingAssetGeneration
                            ? "Generating images..."
                            : hasEverHadContent && isStreaming
                              ? "The GM is narrating..."
                              : "The adventure begins..."}
                      </span>
                    </div>
                    {/* Retry only when scene analysis actually failed */}
                    {hasEverHadContent && !isStreaming && sceneAnalysisFailed && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => retrySceneAnalysis()}
                          className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                        >
                          <RefreshCw size={14} />
                          Retry Scene Analysis
                        </button>
                        <button
                          onClick={() => skipSceneAnalysis()}
                          className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                        >
                          Skip
                        </button>
                      </div>
                    )}
                    {/* Show skip only after stuck timeout — scene processing hung, not failed */}
                    {hasEverHadContent &&
                      !isStreaming &&
                      !sceneProcessed &&
                      sceneStuckVisible &&
                      !sceneAnalysisFailed && (
                        <button
                          onClick={() => skipSceneAnalysis()}
                          className="mt-1 flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                        >
                          Skip
                        </button>
                      )}
                  </>
                )}
                {/* Show retry when generation stopped but no content arrived. */}
                {!isStreaming && !latestAssistantMsg?.content && !startGame.isPending && (
                  <button
                    onClick={() => generate({ chatId: activeChatId, connectionId: null })}
                    className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                  >
                    <RefreshCw size={14} />
                    Retry
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={() => {
                  console.log("[GameSurface] Start Game clicked, chatId:", activeChatId);
                  startGame.mutate(
                    { chatId: activeChatId },
                    {
                      onSuccess: (res) => {
                        console.log("[GameSurface] startGame succeeded:", res);
                        sendMessage("[Start the game]");
                        console.log("[GameSurface] sendMessage called");
                      },
                      onError: (err) => {
                        console.error("[GameSurface] startGame failed:", err);
                      },
                    },
                  );
                }}
                disabled={startGame.isPending}
                className="group flex items-center gap-2 rounded-xl bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-white transition-all hover:scale-105 hover:shadow-lg hover:shadow-[var(--primary)]/30 disabled:opacity-50 disabled:hover:scale-100"
              >
                <Play size={18} className="transition-transform group-hover:scale-110" />
                Start Game
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden bg-black">
      <GameTransitionManager gameState={gameState} location={gameSnapshot?.location ?? null}>
        <DirectionEngine
          directions={activeDirections}
          backgroundUrl={resolvedBackground ?? undefined}
          onPlayingChange={(playing) => {
            setDirectionsPlaying(playing);
            // When intro cinematic finishes, clear the flag
            if (!playing && introCinematicActive) setIntroCinematicActive(false);
          }}
        >
          {/* Full-body VN sprite — active speaker only */}
          <div
            className="transition-opacity duration-700 ease-in-out"
            style={{ opacity: spriteVisible ? 1 : 0, pointerEvents: spriteVisible ? "auto" : "none" }}
          >
            {displaySpriteIds.length > 0 && (
              <Suspense fallback={null}>
                <SpriteOverlay
                  characterIds={displaySpriteIds}
                  messages={narrationMessages}
                  side={displaySpriteIds.length === 1 ? "center" : "right"}
                  spriteExpressions={gameSpriteExpressions}
                  fullBodyOnly
                />
              </Suspense>
            )}
          </div>

          <div className="relative flex min-w-0 h-full flex-col overflow-hidden">
            {/* Fade in all UI chrome after intro cinematic finishes */}
            <div
              className={`absolute inset-0 z-10 flex flex-col transition-opacity duration-1000 ease-out ${
                introCinematicActive ? "pointer-events-none opacity-0" : "opacity-100"
              }`}
            >
              {/* Top-right action controls */}
              <div
                data-tour="game-controls"
                className={cn("pointer-events-none absolute right-3 z-30", travelRestOverlayOffsetClass)}
              >
                {/* Desktop controls */}
                <div className="pointer-events-auto hidden items-center gap-1.5 md:flex">
                  <button
                    onClick={() => setTutorialOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                    title="Game Mode Tutorial"
                  >
                    <HelpCircle size={14} />
                  </button>
                  <button
                    onClick={() => setHistoryOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                    title="History"
                  >
                    <History size={14} />
                  </button>
                  {sessionStatus === "active" ? (
                    <button
                      onClick={handleRequestEndSession}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                      title="End Session"
                    >
                      <Square size={13} />
                    </button>
                  ) : (
                    <button
                      onClick={handleStartNewSession}
                      disabled={startSessionLocked}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-500/20 text-emerald-200 backdrop-blur-md transition-colors hover:bg-emerald-500/35 disabled:opacity-50 disabled:hover:bg-emerald-500/20"
                      title="New Session"
                    >
                      <Play size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => setJournalOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                    title="Journal"
                  >
                    <BookOpen size={14} />
                  </button>
                  <div className="relative" ref={volumePopoverRef}>
                    <button
                      onClick={() => setVolumePopoverOpen((v) => !v)}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                      title="Volume"
                    >
                      {audioMuted || masterVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                    {volumePopoverOpen && (
                      <div className="absolute right-0 top-11 z-50 flex w-9 flex-col items-center gap-2 rounded-xl border border-white/15 bg-black/80 py-4 shadow-xl backdrop-blur-md">
                        <div className="relative flex h-32 w-5 items-end justify-center rounded-full bg-white/10">
                          <div
                            className="absolute bottom-0 w-full rounded-full bg-[var(--primary)]/60"
                            style={{ height: `${masterVolume}%` }}
                          />
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={masterVolume}
                            onChange={(e) => handleVolumeChange(Number(e.target.value))}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            style={{ writingMode: "vertical-lr", direction: "rtl" }}
                          />
                        </div>
                        <span className="text-[10px] tabular-nums text-white/50">{masterVolume}</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setGalleryOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                    title="Gallery"
                  >
                    <Image size={14} />
                  </button>
                  <button
                    onClick={handleRetryScene}
                    disabled={sceneAnalysis.isPending || !latestAssistantMsg?.content}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white disabled:opacity-30 disabled:hover:bg-black/45"
                    title="Retry Scene Analysis"
                  >
                    <RotateCcw size={14} className={sceneAnalysis.isPending ? "animate-spin" : ""} />
                  </button>
                  <button
                    onClick={onOpenSettings}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                    title="Chat Settings"
                  >
                    <Settings2 size={14} />
                  </button>
                </div>

                {/* Mobile controls */}
                <div className="pointer-events-auto md:hidden">
                  <div className="relative">
                    <button
                      onClick={() => setMobileActionsOpen((v) => !v)}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/85 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white"
                      title="Game actions"
                    >
                      <MoreHorizontal size={15} />
                    </button>

                    {mobileActionsOpen && (
                      <div className="absolute right-0 top-11 flex flex-col gap-1 rounded-xl border border-white/15 bg-black/70 p-1.5 backdrop-blur-xl shadow-lg">
                        <button
                          onClick={() => {
                            setTutorialOpen(true);
                            setMobileActionsOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/85 transition-colors hover:bg-white/10 hover:text-white"
                          title="Game Mode Tutorial"
                        >
                          <HelpCircle size={14} />
                        </button>
                        <button
                          onClick={() => {
                            setHistoryOpen(true);
                            setMobileActionsOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          title="History"
                        >
                          <History size={14} />
                        </button>
                        {sessionStatus === "active" ? (
                          <button
                            onClick={() => {
                              handleRequestEndSession();
                              setMobileActionsOpen(false);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10"
                            title="End Session"
                          >
                            <Square size={13} />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              handleStartNewSession();
                              setMobileActionsOpen(false);
                            }}
                            disabled={startSessionLocked}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 disabled:hover:bg-transparent"
                            title="New Session"
                          >
                            <Play size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setJournalOpen(true);
                            setMobileActionsOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          title="Journal"
                        >
                          <BookOpen size={14} />
                        </button>
                        <button
                          onClick={() => {
                            handleToggleMute();
                            setMobileActionsOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          title={audioMuted ? "Unmute Audio" : "Mute Audio"}
                        >
                          {audioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                        </button>
                        <button
                          onClick={() => {
                            setGalleryOpen(true);
                            setMobileActionsOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          title="Gallery"
                        >
                          <Image size={14} />
                        </button>
                        <button
                          onClick={() => {
                            onOpenSettings();
                            setMobileActionsOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          title="Chat Settings"
                        >
                          <Settings2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Dice roll result overlay */}
              {diceRollResult && <GameDiceResult result={diceRollResult} onDismiss={handleDismissDice} />}
              {pendingSkillCheck && (
                <GameSkillCheckResult result={pendingSkillCheck} onDismiss={() => setPendingSkillCheck(null)} />
              )}
              {pendingReaction && (
                <GameElementReaction reaction={pendingReaction} onDismiss={() => setPendingReaction(null)} />
              )}

              {/* Main content area */}
              <div ref={hudSurfaceRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Top-left: Map + Party portraits side by side */}
                <div
                  className={cn(
                    "pointer-events-auto absolute left-3 z-20 flex items-start gap-2",
                    travelRestOverlayOffsetClass,
                  )}
                >
                  {/* Mobile: map icon button that opens modal */}
                  <div data-tour="game-map" className="md:hidden">
                    <MobileMapButton
                      map={currentMap}
                      onMove={handleMapMove}
                      selectedPosition={pendingMapMove?.position ?? null}
                      onGenerateMap={handleGenerateMap}
                      disabled={isStreaming || !narrationDone || !sessionInteractive}
                      gameState={gameState}
                      timeOfDay={gameSnapshot?.time ?? metaTime ?? null}
                    />
                  </div>
                  {/* Desktop: inline minimap */}
                  <div className="hidden md:block">
                    <GameMapPanel
                      map={currentMap}
                      onMove={handleMapMove}
                      selectedPosition={pendingMapMove?.position ?? null}
                      onGenerateMap={handleGenerateMap}
                      disabled={isStreaming || !narrationDone || !sessionInteractive}
                      gameState={gameState}
                      timeOfDay={gameSnapshot?.time ?? metaTime ?? null}
                      chatId={activeChatId}
                      constraintsRef={hudSurfaceRef}
                    />
                  </div>

                  {/* Party portraits — right of map */}
                  {partyMembers.length > 0 && (
                    <div data-tour="game-party">
                      <GamePartyBar partyMembers={partyMembers} partyCards={partyCards} />
                    </div>
                  )}
                </div>

                {/* Dynamic weather effects from tracked game state */}
                {weatherEffectsEnabled && (gameSnapshot?.weather || gameSnapshot?.time) && (
                  <div className="pointer-events-none absolute inset-0 z-[1]">
                    <WeatherEffects weather={gameSnapshot?.weather ?? null} timeOfDay={gameSnapshot?.time ?? null} />
                  </div>
                )}

                {sidecarStartupFailed && (
                  <div className="pointer-events-auto absolute top-4 left-1/2 z-30 w-[min(92vw,42rem)] -translate-x-1/2">
                    <div className="rounded-xl border border-amber-500/20 bg-black/80 px-4 py-3 shadow-lg backdrop-blur-sm">
                      <div className="flex items-start gap-3">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-amber-200">Local scene helper failed to start</div>
                          <div className="mt-1 text-[0.6875rem] leading-relaxed text-white/70">
                            Marinara will keep the game running without the local sidecar for now.
                            {sidecarFailedRuntimeVariant &&
                              ` Runtime: ${sidecarFailedRuntimeVariant.replace(/-/g, " ")}.`}
                            {sidecarStartupError ? ` ${sidecarStartupError}.` : ""}
                          </div>
                          <div className="mt-1 text-[0.6875rem] leading-relaxed text-white/55">
                            Open Local AI Model to retry startup, switch models, or disable local scene analysis
                            temporarily.
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            void refreshSidecarStatus();
                            openSidecarModal(true);
                          }}
                          className="rounded-lg bg-white/10 px-3 py-1.5 text-[0.6875rem] font-medium text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                        >
                          Open Local AI Model
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Image generation failed — retry banner */}
                {assetGenerationFailed && pendingAssetGeneration && (
                  <div className="pointer-events-auto absolute bottom-32 left-1/2 z-30 -translate-x-1/2">
                    <div className="flex items-center gap-3 rounded-xl bg-black/80 px-4 py-2.5 shadow-lg backdrop-blur-sm">
                      <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                      <span className="text-xs text-white/70">Image generation failed</span>
                      <button
                        onClick={retryAssetGeneration}
                        className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                      >
                        <RefreshCw size={12} />
                        Retry
                      </button>
                      <button
                        onClick={() => {
                          setAssetGenerationFailed(false);
                          setPendingAssetGeneration(null);
                        }}
                        className="text-white/40 transition-colors hover:text-white/70"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Scene analysis failed — retry banner (only when narration is still blocked) */}
                {sceneAnalysisFailed && introPresented && (
                  <div className="pointer-events-auto absolute bottom-32 left-1/2 z-30 -translate-x-1/2">
                    <div className="flex items-center gap-3 rounded-xl bg-black/80 px-4 py-2.5 shadow-lg backdrop-blur-sm">
                      <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                      <span className="text-xs text-white/70">Scene analysis failed</span>
                      <button
                        onClick={() => retrySceneAnalysis()}
                        className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                      >
                        <RefreshCw size={12} />
                        Retry
                      </button>
                      <button
                        onClick={() => setSceneAnalysisFailed(false)}
                        className="text-white/40 transition-colors hover:text-white/70"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Game content — Combat UI / TravelView / Narration */}
                {(() => {
                  // Mobile widget slot — rendered inside GameNarration to sit above the narration box
                  const mobileWidgetSlot =
                    !combatUiActive && hudWidgets.length > 0 ? (
                      <div className="pointer-events-auto mb-2 flex items-end justify-between md:hidden">
                        <MobileWidgetPanel widgets={normalizedWidgets} position="hud_left" chatId={activeChatId} />
                        <MobileWidgetPanel widgets={normalizedWidgets} position="hud_right" chatId={activeChatId} />
                      </div>
                    ) : undefined;

                  // Choice cards slot — rendered inside GameNarration above the narration box
                  const choicesSlot =
                    activeChoices && narrationDone ? (
                      <div className="pointer-events-auto mb-2 flex justify-center">
                        <GameChoiceCards
                          choices={activeChoices}
                          onSelect={handleChoiceSelect}
                          disabled={isStreaming || !sessionInteractive}
                        />
                      </div>
                    ) : undefined;

                  if (combatUiActive) {
                    return (
                      <GameCombatUI
                        chatId={activeChatId}
                        party={combatParty}
                        enemies={combatEnemies}
                        onCombatEnd={handleCombatEnd}
                        narration={
                          latestAssistantMsg?.content ? parseGmTags(latestAssistantMsg.content).cleanContent : undefined
                        }
                      />
                    );
                  }
                  if (gameState === "travel_rest") {
                    return (
                      <GameTravelView>
                        <GameNarration
                          messages={narrationMessages}
                          isStreaming={isStreaming}
                          characterMap={characterMap}
                          personaInfo={personaInfo}
                          spriteMap={spriteMap}
                          onActiveSpeakerChange={handleActiveSpeakerChange}
                          onSegmentEnter={handleSegmentEnter}
                          showUserMessages
                          partyDialogue={partyDialogue}
                          partyChatMessageId={partyChatMessageId}
                          scenePreparing={scenePreparing}
                          assetsGenerating={!!pendingAssetGeneration}
                          sceneAnalysisFailed={sceneAnalysisFailed}
                          onRetryScene={retrySceneAnalysis}
                          onSkipScene={skipSceneAnalysis}
                          generationFailed={generationFailed}
                          onRetryGeneration={retryGeneration}
                          isRestored={isRestoredRef.current}
                          restoredSegmentIndex={restoredSegmentIndex}
                          onSegmentChange={handleSegmentChange}
                          onNarrationComplete={setNarrationDone}
                          onReadable={handleReadable}
                          directionsActive={directionsPlaying}
                          widgetSlot={mobileWidgetSlot}
                          choicesSlot={choicesSlot}
                          onOpenInventory={() => setInventoryOpen(true)}
                          inventoryCount={inventoryItems.length}
                          onDeleteMessage={onDeleteMessage}
                          segmentEdits={segmentEdits}
                          onEditSegment={(messageId, segmentIndex, newContent) => {
                            if (messageId) {
                              const key = `segmentEdit:${messageId}:${segmentIndex}`;
                              setSegmentEdits((prev) => {
                                const next = new Map(prev);
                                next.set(`${messageId}:${segmentIndex}`, newContent);
                                return next;
                              });
                              api.patch(`/chats/${activeChatId}/metadata`, { [key]: newContent }).catch(() => {});
                            }
                          }}
                          inputSlot={
                            <GameInput
                              onSend={handleSendGameTurn}
                              onRollDice={handleRollDice}
                              hasPartyMembers={partyMembers.length > 0}
                              pendingMoveLabel={pendingMapMove?.label ?? null}
                              onClearPendingMove={() => setPendingMapMove(null)}
                              disabled={isStreaming || !sessionInteractive}
                              isStreaming={isStreaming}
                              inline
                              draftKey={activeChatId}
                            />
                          }
                        />
                      </GameTravelView>
                    );
                  }
                  return (
                    <GameNarration
                      messages={narrationMessages}
                      isStreaming={isStreaming}
                      characterMap={characterMap}
                      personaInfo={personaInfo}
                      spriteMap={spriteMap}
                      onActiveSpeakerChange={handleActiveSpeakerChange}
                      onSegmentEnter={handleSegmentEnter}
                      showUserMessages
                      partyDialogue={partyDialogue}
                      partyChatMessageId={partyChatMessageId}
                      scenePreparing={scenePreparing}
                      assetsGenerating={!!pendingAssetGeneration}
                      sceneAnalysisFailed={sceneAnalysisFailed}
                      onRetryScene={retrySceneAnalysis}
                      onSkipScene={skipSceneAnalysis}
                      generationFailed={generationFailed}
                      onRetryGeneration={retryGeneration}
                      isRestored={isRestoredRef.current}
                      restoredSegmentIndex={restoredSegmentIndex}
                      onSegmentChange={handleSegmentChange}
                      onNarrationComplete={setNarrationDone}
                      onReadable={handleReadable}
                      directionsActive={directionsPlaying}
                      widgetSlot={mobileWidgetSlot}
                      choicesSlot={choicesSlot}
                      onOpenInventory={() => setInventoryOpen(true)}
                      inventoryCount={inventoryItems.length}
                      onDeleteMessage={onDeleteMessage}
                      segmentEdits={segmentEdits}
                      onEditSegment={(messageId, segmentIndex, newContent) => {
                        // Store edit as an overlay in chat metadata so we don't destroy
                        // the original message content (which contains multi-segment text + GM tags)
                        if (messageId) {
                          const key = `segmentEdit:${messageId}:${segmentIndex}`;
                          // Optimistically update local state so the edit shows immediately
                          setSegmentEdits((prev) => {
                            const next = new Map(prev);
                            next.set(`${messageId}:${segmentIndex}`, newContent);
                            return next;
                          });
                          api.patch(`/chats/${activeChatId}/metadata`, { [key]: newContent }).catch(() => {});
                        }
                      }}
                      inputSlot={
                        <GameInput
                          onSend={handleSendGameTurn}
                          onRollDice={handleRollDice}
                          hasPartyMembers={partyMembers.length > 0}
                          pendingMoveLabel={pendingMapMove?.label ?? null}
                          onClearPendingMove={() => setPendingMapMove(null)}
                          disabled={isStreaming || !sessionInteractive}
                          isStreaming={isStreaming}
                          inline
                          draftKey={activeChatId}
                        />
                      }
                    />
                  );
                })()}

                {/* QTE overlay — absolute, centered */}
                {activeQte && sessionInteractive && (
                  <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center">
                    <GameQteOverlay
                      actions={activeQte.actions.map((a) => ({ label: a }))}
                      timerSeconds={activeQte.timer}
                      onSelect={handleQteSelect}
                      onTimeout={handleQteTimeout}
                    />
                  </div>
                )}

                {/* Session history panel (full overlay) */}
                {historyOpen && (
                  <GameSessionHistory
                    summaries={sessionSummaries}
                    currentSessionNumber={displaySessionNumber}
                    onClose={() => setHistoryOpen(false)}
                  />
                )}
              </div>

              {/* Journal overlay — positioned on the outer column so it covers state indicator + content */}
              {journalOpen && <GameJournal chatId={activeChatId} npcs={npcs} onClose={() => setJournalOpen(false)} />}

              {/* Gallery drawer */}
              <ChatGalleryDrawer
                chat={chat}
                open={galleryOpen}
                onClose={() => setGalleryOpen(false)}
                onIllustrate={() => retryAgents(activeChatId, ["illustrator"])}
              />

              {/* Inventory overlay */}
              <GameInventory
                items={inventoryItems}
                open={inventoryOpen}
                onClose={() => setInventoryOpen(false)}
                canInteract={sessionInteractive && narrationDone && !isStreaming}
                onUseItem={(itemName) => {
                  setInventoryOpen(false);
                  sendMessage(`I use my ${itemName}.`);
                }}
              />

              {/* Readable document display (Notes / Books) */}
              {activeReadable && (
                <GameReadableDisplay
                  type={activeReadable.type}
                  content={activeReadable.content}
                  onClose={() => {
                    const next = readableQueueRef.current.shift();
                    setActiveReadable(next ?? null);
                  }}
                />
              )}

              {/* First-game spotlight tutorial (auto-opens once; (?) button re-opens) */}
              <GameTutorial open={tutorialOpen} onClose={handleCloseTutorial} />

              {/* Inventory notifications */}
              {inventoryNotifications.length > 0 && (
                <div className="pointer-events-none absolute left-1/2 top-20 z-40 -translate-x-1/2 flex flex-col gap-1">
                  {inventoryNotifications.map((n, i) => (
                    <div
                      key={i}
                      className={cn(
                        "animate-in fade-in-0 slide-in-from-bottom-2 rounded-lg border px-4 py-2 text-sm font-semibold shadow-lg backdrop-blur-sm",
                        n.startsWith("You gained")
                          ? "border-emerald-400/30 bg-emerald-900/80 text-emerald-200"
                          : "border-red-400/30 bg-red-900/80 text-red-200",
                      )}
                    >
                      {n}
                    </div>
                  ))}
                </div>
              )}

              {/* HUD Widgets - Left & Right, tops aligned */}
              {!combatUiActive && hudWidgets.length > 0 && (
                <>
                  {/* Desktop: full widget cards */}
                  <div className="pointer-events-none absolute inset-x-3 bottom-24 z-30 hidden items-end justify-between md:flex">
                    <div className="w-44">
                      <GameWidgetPanel
                        widgets={normalizedWidgets}
                        position="hud_left"
                        chatId={activeChatId}
                        constraintsRef={hudSurfaceRef}
                      />
                    </div>
                    <div className="w-44">
                      <GameWidgetPanel
                        widgets={normalizedWidgets}
                        position="hud_right"
                        chatId={activeChatId}
                        constraintsRef={hudSurfaceRef}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </DirectionEngine>

        {/* Right: Party rail spans full game height */}
        {/* REMOVED: Old sidebar replaced by compact GamePartyBar in map area */}
      </GameTransitionManager>

      {/* Character sheet modal */}
      {characterSheetOpen && characterSheetCharId && partyCards[characterSheetCharId] && (
        <GameCharacterSheet
          card={partyCards[characterSheetCharId]}
          onClose={closeCharacterSheet}
          onSave={(gameCard: GameCharacterSheetGameCard | undefined) =>
            handleSaveCharacterSheet(partyCards[characterSheetCharId].title, gameCard)
          }
        />
      )}

      <Modal
        open={confirmEndSessionOpen}
        onClose={() => setConfirmEndSessionOpen(false)}
        title="End Session"
        width="max-w-sm"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--destructive)]/10">
              <AlertTriangle size="1.125rem" className="text-[var(--destructive)]" />
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">
              Are you sure you want to end this session? You can start a new session afterwards, but this one will be
              marked as concluded.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setConfirmEndSessionOpen(false)}
              className="rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmEndSession}
              disabled={concludeSession.isPending}
              className="rounded-lg bg-[var(--destructive)]/15 px-3 py-1.5 text-xs font-medium text-[var(--destructive)] ring-1 ring-[var(--destructive)]/25 transition-colors hover:bg-[var(--destructive)]/25 disabled:opacity-50"
            >
              {concludeSession.isPending ? "Ending..." : "End Session"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
