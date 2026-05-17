// ──────────────────────────────────────────────
// Storage: Game State Snapshots
// ──────────────────────────────────────────────
import { eq, and, ne, desc, inArray } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { gameStateSnapshots } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import { coerceGameStateTextValue, type GameState } from "@marinara-engine/shared";

export type GameStateVisibleAnchor = { messageId: string; swipeIndex: number };

const MANUAL_OVERRIDE_FIELDS = ["date", "time", "location", "weather", "temperature"] as const;

function coerceSnapshotTextFields(fields: Partial<Pick<GameState, (typeof MANUAL_OVERRIDE_FIELDS)[number]>>) {
  return {
    date: coerceGameStateTextValue(fields.date),
    time: coerceGameStateTextValue(fields.time),
    location: coerceGameStateTextValue(fields.location),
    weather: coerceGameStateTextValue(fields.weather),
    temperature: coerceGameStateTextValue(fields.temperature),
  };
}

export function createGameStateStorage(db: DB) {
  return {
    async getLatest(chatId: string) {
      const rows = await db
        .select()
        .from(gameStateSnapshots)
        .where(eq(gameStateSnapshots.chatId, chatId))
        .orderBy(desc(gameStateSnapshots.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Get the latest committed game state — the one the user "accepted" by sending their next message. */
    async getLatestCommitted(chatId: string) {
      const rows = await db
        .select()
        .from(gameStateSnapshots)
        .where(and(eq(gameStateSnapshots.chatId, chatId), eq(gameStateSnapshots.committed, 1)))
        .orderBy(desc(gameStateSnapshots.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async getForGeneration(
      chatId: string,
      options?: {
        preferLatestVisible?: boolean;
        visibleAnchor?: GameStateVisibleAnchor | null;
        excludeMessageId?: string | null;
        fallbackMessageIds?: string[] | null;
      },
    ) {
      const excludeMessageId = options?.excludeMessageId || null;
      const fallbackMessageIds = Array.from(
        new Set((options?.fallbackMessageIds ?? []).filter((id): id is string => typeof id === "string")),
      );
      const latestCommitted = () =>
        fallbackMessageIds.length > 0
          ? this.getLatestCommittedForMessages(chatId, fallbackMessageIds)
          : excludeMessageId
            ? this.getLatestCommittedExcludingMessage(chatId, excludeMessageId)
            : this.getLatestCommitted(chatId);
      const latestAny = () =>
        fallbackMessageIds.length > 0
          ? this.getLatestForMessages(chatId, fallbackMessageIds)
          : excludeMessageId
            ? this.getLatestExcludingMessage(chatId, excludeMessageId)
            : this.getLatest(chatId);

      if (options?.preferLatestVisible) {
        if (options.visibleAnchor?.messageId) {
          const visible = await this.getByChatAndMessage(
            chatId,
            options.visibleAnchor.messageId,
            options.visibleAnchor.swipeIndex,
          );
          if (visible) return visible;
        }
        return (await latestCommitted()) ?? (await latestAny());
      }
      return (await latestCommitted()) ?? (await latestAny());
    },

    /** Get latest game state excluding snapshots tied to a specific message (for regen/swipes). */
    async getLatestExcludingMessage(chatId: string, excludeMessageId: string) {
      const rows = await db
        .select()
        .from(gameStateSnapshots)
        .where(and(eq(gameStateSnapshots.chatId, chatId), ne(gameStateSnapshots.messageId, excludeMessageId)))
        .orderBy(desc(gameStateSnapshots.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Get latest committed state excluding snapshots tied to a specific message (for regen/swipes). */
    async getLatestCommittedExcludingMessage(chatId: string, excludeMessageId: string) {
      const rows = await db
        .select()
        .from(gameStateSnapshots)
        .where(
          and(
            eq(gameStateSnapshots.chatId, chatId),
            eq(gameStateSnapshots.committed, 1),
            ne(gameStateSnapshots.messageId, excludeMessageId),
          ),
        )
        .orderBy(desc(gameStateSnapshots.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async getLatestForMessages(chatId: string, messageIds: string[]) {
      if (messageIds.length === 0) return null;
      const rows = await db
        .select()
        .from(gameStateSnapshots)
        .where(and(eq(gameStateSnapshots.chatId, chatId), inArray(gameStateSnapshots.messageId, messageIds)))
        .orderBy(desc(gameStateSnapshots.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async getLatestCommittedForMessages(chatId: string, messageIds: string[]) {
      if (messageIds.length === 0) return null;
      const rows = await db
        .select()
        .from(gameStateSnapshots)
        .where(
          and(
            eq(gameStateSnapshots.chatId, chatId),
            eq(gameStateSnapshots.committed, 1),
            inArray(gameStateSnapshots.messageId, messageIds),
          ),
        )
        .orderBy(desc(gameStateSnapshots.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async getByMessage(messageId: string, swipeIndex: number = 0) {
      const rows = await db
        .select()
        .from(gameStateSnapshots)
        .where(and(eq(gameStateSnapshots.messageId, messageId), eq(gameStateSnapshots.swipeIndex, swipeIndex)))
        .orderBy(desc(gameStateSnapshots.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Chat-scoped variant of getByMessage (avoids cross-chat collisions for messageId=""). */
    async getByChatAndMessage(chatId: string, messageId: string, swipeIndex: number = 0) {
      const rows = await db
        .select()
        .from(gameStateSnapshots)
        .where(
          and(
            eq(gameStateSnapshots.chatId, chatId),
            eq(gameStateSnapshots.messageId, messageId),
            eq(gameStateSnapshots.swipeIndex, swipeIndex),
          ),
        )
        .orderBy(desc(gameStateSnapshots.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Batch-fetch committed snapshots for multiple messages. Returns a Map of messageId → row. */
    async getCommittedForMessages(messageIds: string[]) {
      if (messageIds.length === 0) return new Map<string, typeof gameStateSnapshots.$inferSelect>();
      const rows = await db
        .select()
        .from(gameStateSnapshots)
        .where(and(inArray(gameStateSnapshots.messageId, messageIds), eq(gameStateSnapshots.committed, 1)));
      const map = new Map<string, typeof gameStateSnapshots.$inferSelect>();
      for (const row of rows) {
        map.set(row.messageId, row);
      }
      return map;
    },

    /** Mark a specific snapshot as committed. */
    async commit(id: string) {
      await db.update(gameStateSnapshots).set({ committed: 1 }).where(eq(gameStateSnapshots.id, id));
    },

    async create(state: Omit<GameState, "id" | "createdAt">, manualOverrides?: Record<string, string> | null) {
      // Remove any prior snapshot for the same message + swipe so duplicates don't accumulate
      if (state.messageId) {
        await db
          .delete(gameStateSnapshots)
          .where(
            and(eq(gameStateSnapshots.messageId, state.messageId), eq(gameStateSnapshots.swipeIndex, state.swipeIndex)),
          );
      }
      const id = newId();
      await db.insert(gameStateSnapshots).values({
        id,
        chatId: state.chatId,
        messageId: state.messageId,
        swipeIndex: state.swipeIndex,
        ...coerceSnapshotTextFields(state),
        presentCharacters: JSON.stringify(state.presentCharacters),
        recentEvents: JSON.stringify(state.recentEvents),
        playerStats: state.playerStats ? JSON.stringify(state.playerStats) : null,
        personaStats: state.personaStats ? JSON.stringify(state.personaStats) : null,
        manualOverrides: manualOverrides ? JSON.stringify(manualOverrides) : null,
        committed: state.committed ? 1 : 0,
        createdAt: now(),
      });
      return id;
    },

    async updateLatest(
      chatId: string,
      fields: Partial<
        Pick<
          GameState,
          | "date"
          | "time"
          | "location"
          | "weather"
          | "temperature"
          | "presentCharacters"
          | "playerStats"
          | "personaStats"
        >
      >,
      /** When true, the edited fields are also recorded as manual overrides. */
      manual?: boolean,
    ) {
      const latest = await this.getLatest(chatId);
      return latest ? this._applyUpdate(latest, fields, manual) : null;
    },

    /**
     * Same as updateLatest but targets a specific (messageId, swipeIndex) snapshot
     * instead of the chronologically newest one. This ensures tracker agents write
     * to the exact same snapshot the world-state agent created for a given swipe.
     *
     * When no snapshot exists for the target (messageId, swipeIndex) — e.g. because
     * the world-state agent is disabled or failed — we clone the provided base
     * snapshot, or the latest snapshot when no base is supplied, into a NEW row for
     * this message+swipe and apply the update there. This avoids corrupting a
     * previous turn's snapshot with new tracker data.
     *
     * options.baseSnapshot is intentionally presence-sensitive: omitted falls back
     * to getLatest(chatId), while an explicit null means no base and creates an
     * empty snapshot for the target.
     */
    async updateByMessage(
      messageId: string,
      swipeIndex: number,
      chatId: string,
      fields: Partial<
        Pick<
          GameState,
          | "date"
          | "time"
          | "location"
          | "weather"
          | "temperature"
          | "presentCharacters"
          | "playerStats"
          | "personaStats"
        >
      >,
      manual?: boolean,
      options?: { baseSnapshot?: typeof gameStateSnapshots.$inferSelect | null },
    ) {
      const snap = await this.getByMessage(messageId, swipeIndex);
      if (snap) return this._applyUpdate(snap, fields, manual);

      // No snapshot for this swipe yet — clone the chosen base into a new row
      // so each (messageId, swipeIndex) gets its own snapshot and we don't
      // corrupt a previous turn's data.
      const latest =
        options && Object.prototype.hasOwnProperty.call(options, "baseSnapshot")
          ? options.baseSnapshot
          : await this.getLatest(chatId);
      if (!latest && !messageId) return null;

      const baseState = {
        chatId,
        messageId,
        swipeIndex,
        date: coerceGameStateTextValue(latest?.date),
        time: coerceGameStateTextValue(latest?.time),
        location: coerceGameStateTextValue(latest?.location),
        weather: coerceGameStateTextValue(latest?.weather),
        temperature: coerceGameStateTextValue(latest?.temperature),
        presentCharacters: latest?.presentCharacters
          ? typeof latest.presentCharacters === "string"
            ? JSON.parse(latest.presentCharacters)
            : latest.presentCharacters
          : [],
        recentEvents: latest?.recentEvents
          ? typeof latest.recentEvents === "string"
            ? JSON.parse(latest.recentEvents)
            : latest.recentEvents
          : [],
        playerStats: latest?.playerStats
          ? typeof latest.playerStats === "string"
            ? JSON.parse(latest.playerStats)
            : latest.playerStats
          : null,
        personaStats: latest?.personaStats
          ? typeof latest.personaStats === "string"
            ? JSON.parse(latest.personaStats)
            : latest.personaStats
          : null,
      };

      // Apply the incoming fields on top of the cloned base
      if (fields.date !== undefined) baseState.date = coerceGameStateTextValue(fields.date);
      if (fields.time !== undefined) baseState.time = coerceGameStateTextValue(fields.time);
      if (fields.location !== undefined) baseState.location = coerceGameStateTextValue(fields.location);
      if (fields.weather !== undefined) baseState.weather = coerceGameStateTextValue(fields.weather);
      if (fields.temperature !== undefined) baseState.temperature = coerceGameStateTextValue(fields.temperature);
      if (fields.presentCharacters !== undefined) baseState.presentCharacters = fields.presentCharacters as any;
      if (fields.playerStats !== undefined) baseState.playerStats = fields.playerStats as any;
      if (fields.personaStats !== undefined) baseState.personaStats = fields.personaStats as any;

      const manualOverrides = manual
        ? MANUAL_OVERRIDE_FIELDS.reduce<Record<string, string>>(
            (acc, key) => {
              const value = fields[key];
              const text = coerceGameStateTextValue(value);
              if (text) acc[key] = text;
              return acc;
            },
            {},
          )
        : {};
      // Manual overrides are one-shot — carry only overrides from this edit.
      await this.create(baseState as any, Object.keys(manualOverrides).length > 0 ? manualOverrides : null);
      return this.getByMessage(messageId, swipeIndex);
    },

    /** Internal: apply field updates + optional manual-override tracking to a snapshot row. */
    async _applyUpdate(
      row: typeof gameStateSnapshots.$inferSelect,
      fields: Partial<
        Pick<
          GameState,
          | "date"
          | "time"
          | "location"
          | "weather"
          | "temperature"
          | "presentCharacters"
          | "playerStats"
          | "personaStats"
        >
      >,
      manual?: boolean,
    ) {
      const updates: Record<string, unknown> = {};
      if (fields.date !== undefined) updates.date = coerceGameStateTextValue(fields.date);
      if (fields.time !== undefined) updates.time = coerceGameStateTextValue(fields.time);
      if (fields.location !== undefined) updates.location = coerceGameStateTextValue(fields.location);
      if (fields.weather !== undefined) updates.weather = coerceGameStateTextValue(fields.weather);
      if (fields.temperature !== undefined) updates.temperature = coerceGameStateTextValue(fields.temperature);
      if (fields.presentCharacters !== undefined) updates.presentCharacters = JSON.stringify(fields.presentCharacters);
      if (fields.playerStats !== undefined)
        updates.playerStats = fields.playerStats ? JSON.stringify(fields.playerStats) : null;
      if (fields.personaStats !== undefined)
        updates.personaStats = fields.personaStats ? JSON.stringify(fields.personaStats) : null;
      if (Object.keys(updates).length === 0) return row;

      // Merge manual override tracking
      if (manual) {
        const existing: Record<string, string> = row.manualOverrides ? JSON.parse(row.manualOverrides as string) : {};
        for (const key of MANUAL_OVERRIDE_FIELDS) {
          if (fields[key] !== undefined) {
            const text = coerceGameStateTextValue(fields[key]);
            // Setting a field to null/empty removes the override so the agent can update it again
            if (!text) {
              delete existing[key];
            } else {
              existing[key] = text;
            }
          }
        }
        updates.manualOverrides = Object.keys(existing).length > 0 ? JSON.stringify(existing) : null;
      }

      await db.update(gameStateSnapshots).set(updates).where(eq(gameStateSnapshots.id, row.id));
      return { ...row, ...updates };
    },

    async deleteForChat(chatId: string) {
      await db.delete(gameStateSnapshots).where(eq(gameStateSnapshots.chatId, chatId));
    },
  };
}
