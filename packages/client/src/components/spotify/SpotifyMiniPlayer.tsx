// ──────────────────────────────────────────────
// Spotify: Global Mini Player
// ──────────────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GripVertical,
  Laptop,
  Loader2,
  Music2,
  Pause,
  Play,
  Repeat1,
  Repeat2,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { api, ApiError } from "../../lib/api-client";
import {
  SPOTIFY_SCENE_TRACK_CHANGE_EVENT,
  SPOTIFY_SCENE_TRACK_CHANGE_SUPPRESS_MS,
  type SpotifySceneTrackChangeDetail,
} from "../../lib/spotify-playback-events";
import { cn } from "../../lib/utils";
import { useUIStore } from "../../stores/ui.store";

type SpotifyRepeatState = "off" | "track" | "context";

type SpotifyPlaybackState = {
  connected: boolean;
  active: boolean;
  isPlaying?: boolean;
  shuffle?: boolean;
  smartShuffle?: boolean;
  repeat?: SpotifyRepeatState;
  progressMs?: number | null;
  durationMs?: number | null;
  item?: {
    name: string;
    artists: string[];
    album: string | null;
    imageUrl: string | null;
    uri: string | null;
  } | null;
  device?: {
    id: string | null;
    name: string;
    type: string | null;
    volume: number | null;
    isActive: boolean;
  } | null;
};

type SpotifyDevicesState = {
  devices: Array<{
    id: string | null;
    name: string;
    type: string | null;
    volume: number | null;
    isActive: boolean;
  }>;
};

type SpotifyAccessTokenResponse = {
  accessToken: string;
  expiresAt: number;
  hasStreamingScope: boolean;
};

type DjMariPlaylistResponse = {
  success: true;
  name: string;
  playlistUrl: string | null;
  requestedTrackCount: number;
  trackCount: number;
  playbackStarted?: boolean;
  playbackError?: string | null;
};

type SpotifyControlAction =
  | { type: "play"; deviceId?: string | null; shouldTransfer?: boolean; uri?: string | null }
  | { type: "pause"; deviceId?: string | null }
  | { type: "next"; deviceId?: string | null }
  | { type: "previous"; deviceId?: string | null }
  | { type: "transfer"; deviceId: string; play?: boolean }
  | { type: "shuffle"; enabled: boolean; deviceId?: string | null }
  | { type: "repeat"; state: SpotifyRepeatState; deviceId?: string | null };

type SpotifyVolumeAction = {
  volume: number;
  deviceId?: string | null;
};

type SpotifyWebPlaybackPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  activateElement?: () => Promise<void>;
  addListener: (event: string, callback: (payload: Record<string, unknown>) => void) => boolean;
  removeListener: (event: string) => boolean;
};

type RangeCssProperties = CSSProperties & Record<`--${string}`, string | number>;

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (callback: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyWebPlaybackPlayer;
    };
  }
}

const spotifyKeys = {
  player: ["spotify", "player"] as const,
  devices: ["spotify", "devices"] as const,
};

const SPOTIFY_GREEN_CLASS = "text-[oklch(0.72_0.18_145)]";
const SPOTIFY_GREEN_BG_CLASS = "bg-[oklch(0.72_0.18_145)]";
const REPEAT_TRACK_END_GRACE_MS = 15_000;
const REPEAT_TRACK_REPLAY_COOLDOWN_MS = 8_000;
const MANUAL_CONTROL_REPEAT_SUPPRESS_MS = 15_000;
const DJ_MARI_PLAYLIST_READY_TOAST_MS = 20_000;
const DOTTOR_SUPPORT_GIF = "/sprites/dottore/dottore_jumping.gif";
const MOBILE_WIDGET_COLLAPSED_SIZE = 48;
const MOBILE_WIDGET_EXPANDED_MAX_WIDTH = 320;
const MOBILE_WIDGET_EXPANDED_HORIZONTAL_GUTTER = 24;
const MOBILE_WIDGET_EXPANDED_HEIGHT = 132;
const MOBILE_WIDGET_VIEWPORT_PADDING = 8;
const SPOTIFY_VOLUME_UNSUPPORTED_MESSAGE =
  "This Spotify device does not allow remote volume control. Use the device volume buttons instead.";

let spotifySdkPromise: Promise<void> | null = null;

function loadSpotifySdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Spotify?.Player) return Promise.resolve();
  if (spotifySdkPromise) return spotifySdkPromise;

  spotifySdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-marinara-spotify-sdk]");
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    if (existing) return;

    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.dataset.marinaraSpotifySdk = "true";
    script.onerror = () => reject(new Error("Spotify Web Playback SDK failed to load."));
    document.body.appendChild(script);
  });

  return spotifySdkPromise;
}

function formatArtists(artists: string[] | undefined) {
  return artists?.filter(Boolean).join(", ") || "Spotify";
}

function getNextRepeatState(state: SpotifyRepeatState | undefined): SpotifyRepeatState {
  if (state === "context") return "track";
  if (state === "track") return "off";
  return "context";
}

function getShuffleTitle(shuffle: boolean) {
  if (shuffle) return "Shuffle on";
  return "Shuffle off";
}

function isBrowserSpotifyDeviceName(name: string | null | undefined): boolean {
  return name === "Marinara Engine";
}

function isPersonalMobileSpotifyDeviceType(type: string | null | undefined): boolean {
  const normalized = type?.toLowerCase() ?? "";
  return normalized === "smartphone" || normalized === "tablet";
}

function clampMobilePosition(x: number, y: number, collapsed: boolean) {
  if (typeof window === "undefined") return { x, y };
  const width = collapsed
    ? MOBILE_WIDGET_COLLAPSED_SIZE
    : Math.min(MOBILE_WIDGET_EXPANDED_MAX_WIDTH, window.innerWidth - MOBILE_WIDGET_EXPANDED_HORIZONTAL_GUTTER);
  const height = collapsed ? MOBILE_WIDGET_COLLAPSED_SIZE : MOBILE_WIDGET_EXPANDED_HEIGHT;
  return {
    x: Math.max(
      MOBILE_WIDGET_VIEWPORT_PADDING,
      Math.min(window.innerWidth - width - MOBILE_WIDGET_VIEWPORT_PADDING, x),
    ),
    y: Math.max(
      MOBILE_WIDGET_VIEWPORT_PADDING,
      Math.min(window.innerHeight - height - MOBILE_WIDGET_VIEWPORT_PADDING, y),
    ),
  };
}

function getMobileWidgetStyle(
  position: { x: number; y: number },
  collapsed: boolean,
): Pick<CSSProperties, "left" | "top"> {
  if (typeof window === "undefined") {
    return { left: position.x, top: position.y };
  }

  return {
    left: Math.max(
      MOBILE_WIDGET_VIEWPORT_PADDING,
      Math.min(window.innerWidth - MOBILE_WIDGET_COLLAPSED_SIZE - MOBILE_WIDGET_VIEWPORT_PADDING, position.x),
    ),
    top: collapsed
      ? position.y
      : Math.max(
          MOBILE_WIDGET_VIEWPORT_PADDING,
          Math.min(window.innerHeight - MOBILE_WIDGET_EXPANDED_HEIGHT - MOBILE_WIDGET_VIEWPORT_PADDING, position.y),
        ),
  };
}

function getMobileExpandedPanelStyle(position: { x: number; y: number }): CSSProperties {
  if (typeof window === "undefined") return {};

  const width = Math.min(
    MOBILE_WIDGET_EXPANDED_MAX_WIDTH,
    window.innerWidth - MOBILE_WIDGET_EXPANDED_HORIZONTAL_GUTTER,
  );
  const opensLeft =
    position.x + width > window.innerWidth - MOBILE_WIDGET_VIEWPORT_PADDING ||
    position.x + MOBILE_WIDGET_COLLAPSED_SIZE / 2 > window.innerWidth / 2;
  const preferredLeft = opensLeft ? position.x + MOBILE_WIDGET_COLLAPSED_SIZE - width : position.x;
  const clampedLeft = Math.max(
    MOBILE_WIDGET_VIEWPORT_PADDING,
    Math.min(window.innerWidth - width - MOBILE_WIDGET_VIEWPORT_PADDING, preferredLeft),
  );

  return {
    width,
    transform: `translateX(${Math.round(clampedLeft - position.x)}px)`,
  };
}

function isSpotifyVolumeUnsupportedError(error: unknown): boolean {
  if (error instanceof ApiError) {
    const payload = error.payload;
    if (payload && typeof payload === "object" && "code" in payload && payload.code === "SPOTIFY_VOLUME_UNSUPPORTED") {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /cannot\s+control\s+device\s+volume|does not allow remote volume control/i.test(message);
}

function isSpotifyRestrictionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /restriction\s+violated/i.test(message);
}

export function SpotifyMiniPlayer({ mobile = false }: { mobile?: boolean }) {
  const qc = useQueryClient();
  const enabled = useUIStore((s) => s.spotifyPlayerEnabled);
  const openRightPanel = useUIStore((s) => s.openRightPanel);
  const openAgentDetail = useUIStore((s) => s.openAgentDetail);
  const collapsed = useUIStore((s) => s.spotifyMobileWidgetCollapsed);
  const setCollapsed = useUIStore((s) => s.setSpotifyMobileWidgetCollapsed);
  const mobilePosition = useUIStore((s) => s.spotifyMobileWidgetPosition);
  const setMobilePosition = useUIStore((s) => s.setSpotifyMobileWidgetPosition);
  const [sdkDeviceId, setSdkDeviceId] = useState<string | null>(null);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [volumeDraft, setVolumeDraft] = useState(50);
  const [volumeUnsupportedDeviceKey, setVolumeUnsupportedDeviceKey] = useState<string | null>(null);
  const previousVolumeRef = useRef(50);
  const previousPlaybackRef = useRef<SpotifyPlaybackState | null>(null);
  const repeatReplayRef = useRef<{ key: string; at: number } | null>(null);
  const suppressRepeatRecoveryUntilRef = useRef(0);
  const djMariToastRef = useRef<string | number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const playerQuery = useQuery({
    queryKey: spotifyKeys.player,
    queryFn: () => api.get<SpotifyPlaybackState>("/spotify/player"),
    enabled,
    staleTime: 2_000,
    refetchInterval: 5_000,
    retry: false,
  });

  const devicesQuery = useQuery({
    queryKey: spotifyKeys.devices,
    queryFn: () => api.get<SpotifyDevicesState>("/spotify/devices"),
    enabled: enabled && mobile,
    staleTime: 2_000,
    refetchInterval: 5_000,
    retry: false,
  });

  const player = playerQuery.data;
  const preferredMobileDevice = useMemo(() => {
    if (!mobile) return null;
    const mobileDevices = (devicesQuery.data?.devices ?? []).filter(
      (device) =>
        !!device.id && !isBrowserSpotifyDeviceName(device.name) && isPersonalMobileSpotifyDeviceType(device.type),
    );
    return mobileDevices.find((device) => device.isActive) ?? mobileDevices[0] ?? null;
  }, [devicesQuery.data?.devices, mobile]);
  const playerDeviceIsBrowser = isBrowserSpotifyDeviceName(player?.device?.name);
  const playerDeviceIsMobile = isPersonalMobileSpotifyDeviceType(player?.device?.type);
  const controlDeviceId =
    mobile && preferredMobileDevice?.id
      ? preferredMobileDevice.id
      : mobile && (!playerDeviceIsMobile || playerDeviceIsBrowser)
        ? undefined
        : (player?.device?.id ?? undefined);
  const controlDevice =
    mobile && preferredMobileDevice
      ? preferredMobileDevice
      : mobile && !playerDeviceIsMobile
        ? null
        : (player?.device ?? null);
  const item = player?.item ?? null;
  const deviceVolume = controlDevice?.volume;
  const volumeDeviceId = mobile ? controlDeviceId : (sdkDeviceId ?? player?.device?.id ?? undefined);
  const volumeDeviceKey = volumeDeviceId ?? controlDevice?.name ?? null;
  const volumeControlUnsupported =
    !!controlDevice &&
    (typeof deviceVolume !== "number" || (!!volumeDeviceKey && volumeUnsupportedDeviceKey === volumeDeviceKey));

  useEffect(() => {
    if (!controlDevice) {
      setVolumeUnsupportedDeviceKey(null);
      return;
    }

    if (typeof deviceVolume !== "number") {
      if (volumeDeviceKey) setVolumeUnsupportedDeviceKey(volumeDeviceKey);
      return;
    }

    setVolumeUnsupportedDeviceKey((current) => (current === volumeDeviceKey ? null : current));
    setVolumeDraft(deviceVolume);
    if (deviceVolume > 0) previousVolumeRef.current = deviceVolume;
  }, [controlDevice, deviceVolume, volumeDeviceKey]);

  useEffect(() => {
    if (!enabled || mobile) return;
    let disposed = false;
    let sdkPlayer: SpotifyWebPlaybackPlayer | null = null;

    void loadSpotifySdk()
      .then(() => {
        if (disposed || !window.Spotify?.Player) return;
        sdkPlayer = new window.Spotify.Player({
          name: "Marinara Engine",
          volume: 0.5,
          getOAuthToken: (callback) => {
            void api
              .get<SpotifyAccessTokenResponse>("/spotify/access-token")
              .then((token) => {
                if (!token.hasStreamingScope) {
                  setSdkError("Reconnect Spotify to enable in-app playback.");
                }
                callback(token.accessToken);
              })
              .catch(() => callback(""));
          },
        });
        sdkPlayer.addListener("ready", (payload) => {
          const deviceId = typeof payload.device_id === "string" ? payload.device_id : null;
          if (!deviceId) return;
          setSdkDeviceId(deviceId);
          setSdkError(null);
        });
        sdkPlayer.addListener("not_ready", (payload) => {
          const deviceId = typeof payload.device_id === "string" ? payload.device_id : null;
          setSdkDeviceId((current) => (current === deviceId ? null : current));
        });
        sdkPlayer.addListener("account_error", () => setSdkError("Spotify Premium is required for in-app playback."));
        sdkPlayer.addListener("authentication_error", () =>
          setSdkError("Reconnect Spotify to refresh playback access."),
        );
        sdkPlayer.addListener("playback_error", () => setSdkError("Spotify playback failed."));
        sdkPlayer.addListener("player_state_changed", () => {
          void qc.invalidateQueries({ queryKey: spotifyKeys.player });
        });
        return sdkPlayer.connect();
      })
      .catch((err) => setSdkError(err instanceof Error ? err.message : "Spotify SDK failed."));

    return () => {
      disposed = true;
      if (sdkPlayer) {
        sdkPlayer.removeListener("ready");
        sdkPlayer.removeListener("not_ready");
        sdkPlayer.removeListener("account_error");
        sdkPlayer.removeListener("authentication_error");
        sdkPlayer.removeListener("playback_error");
        sdkPlayer.removeListener("player_state_changed");
        sdkPlayer.disconnect();
      }
    };
  }, [enabled, mobile, qc]);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: spotifyKeys.player });
  }, [qc]);

  const runControl = useMutation({
    mutationFn: async (action: SpotifyControlAction) => {
      if (action.type === "pause") return api.put("/spotify/player/pause", { deviceId: action.deviceId ?? undefined });
      if (action.type === "play") {
        if (action.shouldTransfer && action.deviceId) {
          await api.put("/spotify/player/transfer", { deviceId: action.deviceId, play: true }).catch(() => undefined);
        }
        return api.put("/spotify/player/play", {
          deviceId: action.deviceId ?? undefined,
          uri: action.uri ?? undefined,
        });
      }
      if (action.type === "next") return api.post("/spotify/player/next", { deviceId: action.deviceId ?? undefined });
      if (action.type === "previous") {
        return api.post("/spotify/player/previous", { deviceId: action.deviceId ?? undefined });
      }
      if (action.type === "transfer") {
        return api.put("/spotify/player/transfer", { deviceId: action.deviceId, play: action.play === true });
      }
      if (action.type === "shuffle") {
        return api.put("/spotify/player/shuffle", { enabled: action.enabled, deviceId: action.deviceId ?? undefined });
      }
      return api.put("/spotify/player/repeat", { state: action.state, deviceId: action.deviceId ?? undefined });
    },
    onMutate: async (action) => {
      if (
        action.type === "pause" ||
        action.type === "next" ||
        action.type === "previous" ||
        action.type === "transfer" ||
        (action.type === "repeat" && action.state !== "track")
      ) {
        suppressRepeatRecoveryUntilRef.current = Date.now() + MANUAL_CONTROL_REPEAT_SUPPRESS_MS;
      }
      await qc.cancelQueries({ queryKey: spotifyKeys.player });
      const previous = qc.getQueryData<SpotifyPlaybackState>(spotifyKeys.player);
      qc.setQueryData<SpotifyPlaybackState>(spotifyKeys.player, (current) => {
        if (!current) return current;
        if (action.type === "play") return { ...current, active: true, isPlaying: true };
        if (action.type === "pause") return { ...current, isPlaying: false };
        if (action.type === "shuffle") return { ...current, shuffle: action.enabled, smartShuffle: false };
        if (action.type === "repeat") return { ...current, repeat: action.state };
        return current;
      });
      return { previous };
    },
    onSuccess: (_data, action) => {
      if (action.type === "repeat" || action.type === "shuffle") {
        window.setTimeout(invalidate, 750);
        return;
      }
      invalidate();
    },
    onError: (error, _action, context) => {
      if (context?.previous) qc.setQueryData(spotifyKeys.player, context.previous);
      if (isSpotifyRestrictionError(error)) {
        toast.info("Spotify rejected that command on the current device. Open the Spotify app and try again.");
        return;
      }
      toast.error(error instanceof Error ? error.message : "Spotify control failed.");
    },
  });

  const setVolume = useMutation({
    mutationFn: (action: SpotifyVolumeAction) =>
      api.put("/spotify/player/volume", { volume: action.volume, deviceId: action.deviceId ?? undefined }),
    onMutate: async (action) => {
      await qc.cancelQueries({ queryKey: spotifyKeys.player });
      const previous = qc.getQueryData<SpotifyPlaybackState>(spotifyKeys.player);
      qc.setQueryData<SpotifyPlaybackState>(spotifyKeys.player, (current) => {
        if (!current?.device) return current;
        return { ...current, device: { ...current.device, volume: action.volume } };
      });
      return { previous };
    },
    onSuccess: invalidate,
    onError: (error, volume, context) => {
      if (context?.previous) qc.setQueryData(spotifyKeys.player, context.previous);
      if (isSpotifyVolumeUnsupportedError(error)) {
        const key = volume.deviceId ?? player?.device?.name ?? null;
        if (key) setVolumeUnsupportedDeviceKey(key);
        toast.info(SPOTIFY_VOLUME_UNSUPPORTED_MESSAGE);
        return;
      }
      toast.error(error instanceof Error ? error.message : "Spotify volume failed.");
    },
  });

  const dismissDjMariToast = useCallback(() => {
    if (djMariToastRef.current !== null) {
      toast.dismiss(djMariToastRef.current);
      djMariToastRef.current = null;
    }
  }, []);

  const showDjMariToast = useCallback(() => {
    dismissDjMariToast();
    djMariToastRef.current = toast.custom(
      (id) => (
        <div className="relative flex max-w-[22rem] items-center gap-3 rounded-xl border border-primary/35 bg-card/95 p-3 pr-9 text-card-foreground shadow-2xl backdrop-blur-xl">
          <button
            type="button"
            onClick={() => toast.dismiss(id)}
            className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Dismiss"
          >
            <X size="0.875rem" />
          </button>
          <img
            src={DOTTOR_SUPPORT_GIF}
            alt=""
            className="h-14 w-14 shrink-0 rounded-lg object-contain"
            draggable={false}
          />
          <p className="text-sm font-medium leading-snug">DJ Mari is composing a playlist for you, hold on tight!</p>
        </div>
      ),
      { duration: Infinity, position: "bottom-right" },
    );
  }, [dismissDjMariToast]);

  useEffect(() => {
    if (!enabled) return;
    const handleSceneTrackChange = (event: Event) => {
      const detail = (event as CustomEvent<SpotifySceneTrackChangeDetail>).detail;
      if (!detail?.uri) return;
      suppressRepeatRecoveryUntilRef.current = Date.now() + SPOTIFY_SCENE_TRACK_CHANGE_SUPPRESS_MS;
      repeatReplayRef.current = null;
      previousPlaybackRef.current = null;
    };

    window.addEventListener(SPOTIFY_SCENE_TRACK_CHANGE_EVENT, handleSceneTrackChange);
    return () => window.removeEventListener(SPOTIFY_SCENE_TRACK_CHANGE_EVENT, handleSceneTrackChange);
  }, [enabled]);

  const createDjMariPlaylist = useMutation({
    mutationFn: () =>
      api.post<DjMariPlaylistResponse>("/spotify/dj-mari-playlist", {
        deviceId: mobile ? controlDeviceId : (sdkDeviceId ?? player?.device?.id ?? undefined),
      }),
    onMutate: showDjMariToast,
    onSuccess: (result) => {
      dismissDjMariToast();
      invalidate();
      toast.success("DJ Mari playlist is ready", {
        description: `${result.name} - ${result.trackCount} tracks`,
        duration: DJ_MARI_PLAYLIST_READY_TOAST_MS,
        action: result.playlistUrl
          ? {
              label: "Open playlist",
              onClick: () => window.open(result.playlistUrl!, "_blank", "noopener,noreferrer"),
            }
          : undefined,
      });
      if (result.playbackStarted === false) {
        toast.warning(result.playbackError ?? "Playlist created, but Spotify did not start playback.");
      }
    },
    onError: (error) => {
      dismissDjMariToast();
      toast.error(error instanceof Error ? error.message : "DJ Mari could not create the playlist.");
    },
  });

  const handlePlayPause = useCallback(async () => {
    if (runControl.isPending) return;
    if (player?.isPlaying) {
      runControl.mutate({ type: "pause", deviceId: controlDeviceId });
      return;
    }
    runControl.mutate({
      type: "play",
      deviceId: mobile ? controlDeviceId : (sdkDeviceId ?? player?.device?.id ?? undefined),
      shouldTransfer: !mobile && !player?.active && !!sdkDeviceId,
    });
  }, [controlDeviceId, mobile, player?.active, player?.device?.id, player?.isPlaying, runControl, sdkDeviceId]);

  const openSpotifyAgent = useCallback(() => {
    openRightPanel("agents");
    openAgentDetail("spotify");
  }, [openAgentDetail, openRightPanel]);

  const commitVolume = useCallback(() => {
    if (volumeControlUnsupported) {
      toast.info(SPOTIFY_VOLUME_UNSUPPORTED_MESSAGE);
      return;
    }
    setVolume.mutate({
      volume: Math.max(0, Math.min(100, Math.round(volumeDraft))),
      deviceId: volumeDeviceId,
    });
  }, [setVolume, volumeControlUnsupported, volumeDeviceId, volumeDraft]);

  const toggleMute = useCallback(() => {
    if (volumeControlUnsupported) {
      toast.info(SPOTIFY_VOLUME_UNSUPPORTED_MESSAGE);
      return;
    }
    const currentVolume = Math.max(0, Math.min(100, Math.round(volumeDraft)));
    const nextVolume = currentVolume > 0 ? 0 : Math.max(1, Math.min(100, Math.round(previousVolumeRef.current || 50)));
    if (currentVolume > 0) previousVolumeRef.current = currentVolume;
    setVolumeDraft(nextVolume);
    setVolume.mutate({ volume: nextVolume, deviceId: volumeDeviceId });
  }, [setVolume, volumeControlUnsupported, volumeDeviceId, volumeDraft]);

  const handleShufflePress = useCallback(
    (args: { shuffle: boolean; smartShuffle: boolean; deviceId?: string | null }) => {
      runControl.mutate({ type: "shuffle", enabled: !(args.shuffle || args.smartShuffle), deviceId: args.deviceId });
    },
    [runControl],
  );

  useEffect(() => {
    const previous = previousPlaybackRef.current;
    previousPlaybackRef.current = player ?? null;

    const repeatTrackEnabled = player?.repeat === "track" || previous?.repeat === "track";
    if (!previous || !player || !repeatTrackEnabled) return;
    if (runControl.isPending || Date.now() < suppressRepeatRecoveryUntilRef.current) return;

    const previousUri = previous.item?.uri;
    const currentUri = player.item?.uri;
    if (!previousUri || previous.isPlaying !== true) return;
    if (typeof previous.progressMs !== "number" || typeof previous.durationMs !== "number") return;
    if (previous.durationMs <= 0) return;

    const wasNearEnd = previous.durationMs - previous.progressMs <= REPEAT_TRACK_END_GRACE_MS;
    if (!wasNearEnd) return;

    const currentStoppedOnSameTrack = currentUri === previousUri && player.isPlaying === false;
    const advancedPastRepeatedTrack = !!currentUri && currentUri !== previousUri;
    const lostPlaybackAtEnd = !currentUri && player.active === false;
    if (!currentStoppedOnSameTrack && !advancedPastRepeatedTrack && !lostPlaybackAtEnd) return;

    const replayKey = `${previousUri}:${previous.durationMs}`;
    const lastReplay = repeatReplayRef.current;
    if (lastReplay?.key === replayKey && Date.now() - lastReplay.at < REPEAT_TRACK_REPLAY_COOLDOWN_MS) return;

    repeatReplayRef.current = { key: replayKey, at: Date.now() };
    runControl.mutate({
      type: "play",
      uri: previousUri,
      deviceId: player.device?.id ?? previous.device?.id ?? sdkDeviceId ?? undefined,
    });
  }, [player, runControl, sdkDeviceId]);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!mobile) return;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: mobilePosition.x,
        originY: mobilePosition.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [mobile, mobilePosition.x, mobilePosition.y],
  );

  const moveDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const next = clampMobilePosition(
        drag.originX + event.clientX - drag.startX,
        drag.originY + event.clientY - drag.startY,
        collapsed,
      );
      setMobilePosition(next);
    },
    [collapsed, setMobilePosition],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const moved = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      dragRef.current = null;
      if (moved < 6 && mobile && collapsed) setCollapsed(false);
    },
    [collapsed, mobile, setCollapsed],
  );

  const title = item?.name ?? (playerQuery.isError ? "Spotify not connected" : "Spotify");
  const subtitle = item ? formatArtists(item.artists) : sdkError || "No active playback";
  const cover = item?.imageUrl;
  const playPauseBusy =
    runControl.isPending && (runControl.variables?.type === "play" || runControl.variables?.type === "pause");
  const shuffleActive = player?.shuffle === true;
  const smartShuffleActive = player?.smartShuffle === true;
  const shuffleEnabled = shuffleActive || smartShuffleActive;
  const shuffleTitle = getShuffleTitle(shuffleEnabled);
  const repeatState = player?.repeat ?? "off";
  const RepeatIcon = repeatState === "track" ? Repeat1 : Repeat2;
  const repeatTitle =
    repeatState === "track" ? "Repeat track" : repeatState === "context" ? "Repeat playlist" : "Repeat off";
  const canTransferToApp = !mobile && !!sdkDeviceId && player?.device?.id !== sdkDeviceId;
  const progressPercent =
    typeof player?.progressMs === "number" && typeof player.durationMs === "number" && player.durationMs > 0
      ? Math.max(0, Math.min(100, (player.progressMs / player.durationMs) * 100))
      : 0;
  const deviceId = controlDeviceId;
  const volumeMuted = volumeDraft <= 0;
  const VolumeIcon = volumeMuted ? VolumeX : Volume2;
  const spotifyVolumeStyle: RangeCssProperties = useMemo(
    () => ({
      "--range-progress": `${volumeDraft}%`,
      "--range-track-color": "oklch(0.36 0.006 145)",
      "--range-fill-color": "oklch(0.96 0.006 145)",
      "--range-thumb-color": "oklch(0.96 0.006 145)",
      "--range-thumb-size": "0.6875rem",
      "--range-track-height": "0.25rem",
      "--range-thumb-shadow": "0 0 0 0.125rem oklch(0.16 0.006 145)",
    }),
    [volumeDraft],
  );
  const mobileWidgetStyle = useMemo(() => getMobileWidgetStyle(mobilePosition, collapsed), [collapsed, mobilePosition]);
  const mobileExpandedPanelStyle = useMemo(() => getMobileExpandedPanelStyle(mobilePosition), [mobilePosition]);
  const volumeControls = useMemo(() => {
    const stopPointer = (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation();

    if (volumeControlUnsupported) {
      return (
        <button
          type="button"
          className="flex w-full shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-left text-[oklch(0.70_0.012_145)] transition-colors hover:bg-[oklch(0.22_0.008_145)] hover:text-[oklch(0.96_0.006_145)]"
          onPointerDown={stopPointer}
          onPointerMove={stopPointer}
          onPointerUp={stopPointer}
          onPointerCancel={stopPointer}
          onClick={(event) => {
            event.stopPropagation();
            toast.info(SPOTIFY_VOLUME_UNSUPPORTED_MESSAGE);
          }}
          title={SPOTIFY_VOLUME_UNSUPPORTED_MESSAGE}
        >
          <Volume2 size="0.75rem" className="shrink-0" />
          <span className="min-w-0 truncate text-[0.58rem] font-medium leading-tight">Use device volume</span>
        </button>
      );
    }

    return (
      <div
        className="flex w-full shrink-0 items-center gap-1"
        onPointerDown={stopPointer}
        onPointerMove={stopPointer}
        onPointerUp={stopPointer}
        onPointerCancel={stopPointer}
      >
        <button
          type="button"
          onClick={toggleMute}
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[oklch(0.70_0.012_145)] transition-colors hover:text-[oklch(0.96_0.006_145)]",
            volumeMuted && SPOTIFY_GREEN_CLASS,
          )}
          title={volumeMuted ? "Restore volume" : "Mute"}
        >
          <VolumeIcon size="0.75rem" />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volumeDraft}
          onChange={(event) => setVolumeDraft(Number(event.target.value))}
          onPointerUp={commitVolume}
          onKeyUp={commitVolume}
          onBlur={commitVolume}
          className="mari-spotify-volume-slider w-full"
          style={spotifyVolumeStyle}
          title="Volume"
        />
      </div>
    );
  }, [VolumeIcon, commitVolume, spotifyVolumeStyle, toggleMute, volumeControlUnsupported, volumeDraft, volumeMuted]);

  const compactBody = useMemo(
    () => (
      <>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[0.375rem] bg-[oklch(0.23_0.006_145)] ring-1 ring-[oklch(0.34_0.01_145)]">
            {cover ? (
              <img src={cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <Music2 size="0.875rem" className={SPOTIFY_GREEN_CLASS} />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[0.6875rem] font-semibold leading-tight text-[oklch(0.96_0.006_145)]">
              {title}
            </p>
            <p className="truncate text-[0.5625rem] leading-tight text-[oklch(0.72_0.012_145)]">{subtitle}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => handleShufflePress({ shuffle: shuffleActive, smartShuffle: smartShuffleActive, deviceId })}
            className={cn(
              "relative inline-flex h-7 w-7 items-center justify-center rounded-full text-[oklch(0.70_0.012_145)] transition-colors hover:text-[oklch(0.96_0.006_145)]",
              shuffleEnabled && SPOTIFY_GREEN_CLASS,
            )}
            aria-pressed={shuffleEnabled}
            title={shuffleTitle}
          >
            <Shuffle size="0.8125rem" />
          </button>
          <button
            type="button"
            onClick={() => runControl.mutate({ type: "previous", deviceId })}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[oklch(0.82_0.01_145)] transition-colors hover:text-[oklch(0.96_0.006_145)]"
            title="Previous"
          >
            <SkipBack size="0.8125rem" />
          </button>
          <button
            type="button"
            onClick={() => void handlePlayPause()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[oklch(0.96_0.006_145)] text-[oklch(0.16_0.006_145)] shadow-[0_1px_8px_rgba(29,185,84,0.18)] transition-transform hover:scale-105 active:scale-95"
            title={player?.isPlaying ? "Pause" : "Play"}
          >
            {playPauseBusy ? (
              <Loader2 size="0.8125rem" className="animate-spin" />
            ) : player?.isPlaying ? (
              <Pause size="0.8125rem" />
            ) : (
              <Play size="0.8125rem" className="translate-x-px" />
            )}
          </button>
          <button
            type="button"
            onClick={() => runControl.mutate({ type: "next", deviceId })}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[oklch(0.82_0.01_145)] transition-colors hover:text-[oklch(0.96_0.006_145)]"
            title="Next"
          >
            <SkipForward size="0.8125rem" />
          </button>
          <button
            type="button"
            onClick={() => runControl.mutate({ type: "repeat", state: getNextRepeatState(repeatState), deviceId })}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-full text-[oklch(0.70_0.012_145)] transition-colors hover:text-[oklch(0.96_0.006_145)]",
              repeatState !== "off" && SPOTIFY_GREEN_CLASS,
            )}
            aria-pressed={repeatState !== "off"}
            title={repeatTitle}
          >
            <RepeatIcon size="0.8125rem" />
          </button>
          <button
            type="button"
            onClick={() => createDjMariPlaylist.mutate()}
            disabled={createDjMariPlaylist.isPending}
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-[0.625rem] font-black leading-none text-[oklch(0.70_0.012_145)] transition-colors hover:text-[oklch(0.96_0.006_145)] disabled:cursor-wait disabled:opacity-80"
            title="DJ Mari composes a playlist for you!"
            aria-label="DJ Mari composes a playlist for you!"
          >
            {createDjMariPlaylist.isPending ? <Loader2 size="0.8125rem" className="animate-spin" /> : "DJ"}
          </button>
          {canTransferToApp && (
            <button
              type="button"
              onClick={() =>
                runControl.mutate({ type: "transfer", deviceId: sdkDeviceId, play: player?.isPlaying === true })
              }
              className="hidden h-7 w-7 items-center justify-center rounded-full text-[oklch(0.70_0.012_145)] transition-colors hover:text-[oklch(0.96_0.006_145)] sm:inline-flex"
              title="Use Marinara player"
            >
              <Laptop size="0.8125rem" />
            </button>
          )}
          <button
            type="button"
            onClick={openSpotifyAgent}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[oklch(0.70_0.012_145)] transition-colors hover:text-[oklch(0.96_0.006_145)]"
            title="Spotify setup"
          >
            <Settings size="0.8125rem" />
          </button>
        </div>
      </>
    ),
    [
      canTransferToApp,
      cover,
      createDjMariPlaylist,
      deviceId,
      handleShufflePress,
      handlePlayPause,
      openSpotifyAgent,
      playPauseBusy,
      player?.isPlaying,
      RepeatIcon,
      repeatState,
      repeatTitle,
      runControl,
      sdkDeviceId,
      shuffleActive,
      shuffleEnabled,
      shuffleTitle,
      smartShuffleActive,
      subtitle,
      title,
    ],
  );

  if (!enabled) return null;

  if (mobile) {
    return (
      <div
        className="fixed z-[60] md:hidden"
        style={mobileWidgetStyle}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {collapsed ? (
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[oklch(0.30_0.012_145)] bg-[oklch(0.16_0.006_145)] text-[oklch(0.72_0.18_145)] shadow-lg backdrop-blur-xl">
            <Music2 size="1.125rem" />
          </div>
        ) : (
          <div
            className="rounded-xl border border-[oklch(0.30_0.012_145)] bg-[oklch(0.16_0.006_145)] p-2 shadow-2xl backdrop-blur-xl"
            style={mobileExpandedPanelStyle}
          >
            <div className="mb-1 flex items-center gap-1">
              <GripVertical size="0.875rem" className="text-[oklch(0.70_0.012_145)]" />
              <span className="flex-1 truncate text-[0.625rem] font-medium text-[oklch(0.70_0.012_145)]">
                {player?.device?.name ?? "Spotify"}
              </span>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onPointerMove={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
                onPointerCancel={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setCollapsed(true);
                }}
                className="rounded-full p-1 text-[oklch(0.70_0.012_145)] hover:text-[oklch(0.96_0.006_145)]"
                title="Close player"
              >
                <X size="0.875rem" />
              </button>
            </div>
            <div className="flex items-center gap-2">{compactBody}</div>
            <div className="mt-2">{volumeControls}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative hidden h-10 min-w-0 max-w-[31rem] flex-1 items-center gap-2 overflow-hidden rounded-full border border-[oklch(0.30_0.012_145)] bg-[oklch(0.16_0.006_145)] px-2.5 md:flex">
      {compactBody}
      <div className="hidden w-24 lg:flex">{volumeControls}</div>
      <div className="pointer-events-none absolute bottom-0 left-3 right-3 h-px overflow-hidden rounded-full bg-[oklch(0.28_0.01_145)]">
        <div className={cn("h-full rounded-full", SPOTIFY_GREEN_BG_CLASS)} style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
}

export function SpotifyMobileWidget() {
  const enabled = useUIStore((s) => s.spotifyPlayerEnabled);

  if (!enabled) return null;

  return <SpotifyMiniPlayer mobile />;
}
