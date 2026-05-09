import test from "node:test";
import assert from "node:assert/strict";
import type { GameNpc, SessionSummary } from "@marinara-engine/shared";
import {
  buildGmFormatReminder,
  buildGmSystemPrompt,
  buildSessionConclusionPrompt,
  buildSessionSummaryPrompt,
} from "../src/services/game/gm-prompts.js";
import { buildRecapPrompt } from "../src/services/game/session.service.js";

function makeSummary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    sessionNumber: overrides.sessionNumber ?? 1,
    summary: overrides.summary ?? "Session summary.",
    resumePoint: overrides.resumePoint ?? "Resume point.",
    partyDynamics: overrides.partyDynamics ?? "Party dynamics.",
    partyState: overrides.partyState ?? "Party state.",
    keyDiscoveries: overrides.keyDiscoveries ?? [],
    characterMoments: overrides.characterMoments ?? [],
    littleDetails: overrides.littleDetails ?? [],
    statsSnapshot: overrides.statsSnapshot ?? {},
    npcUpdates: overrides.npcUpdates ?? [],
    timestamp: overrides.timestamp ?? "2026-04-23T00:00:00.000Z",
  };
}

test("GM prompt includes every prior session summary but only the latest session detail block", () => {
  const prompt = buildGmSystemPrompt({
    gameActiveState: "exploration",
    storyArc: null,
    plotTwists: null,
    map: null,
    npcs: [],
    sessionSummaries: [
      makeSummary({
        sessionNumber: 1,
        summary: "Session one summary with the old bridge fight.",
        resumePoint: "Resume from the ruined bridge.",
        partyDynamics: "session-one-dynamics",
        keyDiscoveries: ["session-one-discovery"],
        characterMoments: ["session-one-moment"],
        npcUpdates: ["session-one-npc-update"],
        statsSnapshot: { marker: "session-one-stats" },
      }),
      makeSummary({
        sessionNumber: 2,
        summary: "Session two summary with the archive break-in.",
        resumePoint: "Resume from the archive vault.",
        partyDynamics: "session-two-dynamics",
        keyDiscoveries: ["session-two-discovery"],
        characterMoments: ["session-two-moment"],
        npcUpdates: ["session-two-npc-update"],
        statsSnapshot: { marker: "session-two-stats" },
      }),
      makeSummary({
        sessionNumber: 3,
        summary: "Session three summary with the observatory collapse.",
        resumePoint: "Resume with the party hanging from the observatory lift.",
        partyDynamics: "session-three-dynamics",
        keyDiscoveries: ["session-three-discovery"],
        characterMoments: ["session-three-moment"],
        npcUpdates: ["session-three-npc-update"],
        statsSnapshot: { marker: "session-three-stats" },
      }),
    ],
    sessionNumber: 4,
    partyNames: ["Aster"],
    playerName: "Mari",
    playerCard: null,
    gmCharacterCard: null,
    difficulty: "normal",
    genre: "fantasy",
    setting: "original",
    tone: "balanced",
  });

  assert.match(prompt, /Session 1 summary:\nSession one summary with the old bridge fight\./);
  assert.match(prompt, /Session 2 summary:\nSession two summary with the archive break-in\./);
  assert.match(prompt, /Session 3 summary:\nSession three summary with the observatory collapse\./);
  assert.match(prompt, /<latest_session_continuity>/);
  assert.match(prompt, /Latest completed session: 3/);
  assert.match(prompt, /Resume point: Resume with the party hanging from the observatory lift\./);
  assert.match(prompt, /Party dynamics: session-three-dynamics/);
  assert.match(prompt, /Key discoveries: session-three-discovery/);
  assert.doesNotMatch(prompt, /session-one-dynamics/);
  assert.doesNotMatch(prompt, /session-two-discovery/);
  assert.doesNotMatch(prompt, /session-two-npc-update/);
  assert.doesNotMatch(prompt, /session-one-stats/);
});

test("GM prompt tolerates legacy partial session summaries and NPC records", () => {
  const prompt = buildGmSystemPrompt({
    gameActiveState: "exploration",
    storyArc: null,
    plotTwists: ["A sealed door opens soon."],
    map: null,
    npcs: [
      {
        name: "Archivist Ilya",
        location: "Library",
        reputation: 12,
        met: true,
      },
    ] as unknown as GameNpc[],
    sessionSummaries: [
      {
        summary: "The party escaped the archive.",
        resumePoint: "Resume outside the locked archive.",
        revelations: ["The key was copied."],
      },
    ] as unknown as SessionSummary[],
    sessionNumber: 2,
    partyNames: ["Aster"],
    playerName: "Mari",
    playerCard: null,
    gmCharacterCard: null,
    difficulty: "normal",
    genre: "fantasy",
    setting: "original",
    tone: "balanced",
  });

  assert.match(prompt, /Session 1 summary:\nThe party escaped the archive\./);
  assert.match(prompt, /Resume point: Resume outside the locked archive\./);
  assert.match(prompt, /Key discoveries: The key was copied\./);
  assert.match(prompt, /Archivist Ilya @ Library/);
});

test("session summary prompt requires a resume point and cross-field dedupe", () => {
  const prompt = buildSessionSummaryPrompt("Polish");

  assert.match(prompt, /resumePoint/);
  assert.match(prompt, /key events in 2–4 paragraphs/);
  assert.match(prompt, /littleDetails/);
  assert.match(prompt, /small personal details to recall later/);
  assert.match(prompt, /Each fact belongs in the single best category only once\./);
  assert.match(prompt, /Use this single bucket for both discoveries and reveals\./);
  assert.doesNotMatch(prompt, /revelations/);
  assert.match(prompt, /Language: write every natural-language value in Polish\./);
  assert.match(prompt, /Output valid JSON only\./);
});

test("GM prompt normalizes native language labels to canonical English names", () => {
  const prompt = buildGmSystemPrompt({
    gameActiveState: "exploration",
    storyArc: null,
    plotTwists: null,
    map: null,
    npcs: [],
    sessionSummaries: [],
    sessionNumber: 1,
    partyNames: ["Aster"],
    playerName: "Mari",
    playerCard: null,
    gmCharacterCard: null,
    difficulty: "normal",
    genre: "fantasy",
    setting: "original",
    tone: "balanced",
    language: "Polski",
  });

  assert.match(prompt, /Write all narration, dialogue, descriptions, and game text in Polish/);
  assert.match(
    prompt,
    /only XML tags, commands, structured field names, and deliberate proper nouns or code terms may stay in English/,
  );
  assert.match(prompt, /The prose must read as native Polish, not translated from English:/);
  assert.match(
    prompt,
    /remove grammar errors, awkward calques, mixed-language scaffolding, and untranslated filler before finalizing\./,
  );
  assert.doesNotMatch(prompt, /in Polski/);
});

test("GM format reminder reinforces native-language output quality near generation", () => {
  const prompt = buildGmFormatReminder({
    gameActiveState: "exploration",
    sessionNumber: 1,
    partyNames: ["Aster"],
    playerName: "Mari",
    language: "Polski",
  });

  assert.match(prompt, /Write directly in Polish as a native speaker would\./);
  assert.match(prompt, /The English examples below illustrate structure and format only\./);
  assert.match(prompt, /Do not mirror their syntax, sentence length, or phrasing\./);
  assert.match(prompt, /Your output must be natural and grammatical in Polish/);
  assert.match(prompt, /Only tags, commands, field names, and intentional proper nouns stay in English\./);
  assert.doesNotMatch(prompt, /native Polski/);
});

test("GM format reminder only allows explicit content for NSFW games", () => {
  const sfwPrompt = buildGmFormatReminder({
    gameActiveState: "exploration",
    sessionNumber: 1,
    partyNames: ["Aster"],
    playerName: "Mari",
    rating: "sfw",
  });
  const nsfwPrompt = buildGmFormatReminder({
    gameActiveState: "exploration",
    sessionNumber: 1,
    partyNames: ["Aster"],
    playerName: "Mari",
    rating: "nsfw",
  });

  assert.doesNotMatch(sfwPrompt, /Adult mode enabled, explicit content allowed\./);
  assert.match(nsfwPrompt, /Adult mode enabled, explicit content allowed\./);
});

test("GM format reminder documents the sparse skill_check command for engine-resolved checks", () => {
  const prompt = buildGmFormatReminder({
    gameActiveState: "exploration",
    sessionNumber: 1,
    partyNames: ["Aster"],
    playerName: "Mari",
  });

  // AI-initiated checks emit only skill + dc; the engine fills in the rest.
  assert.match(prompt, /\[skill_check: skill="Skill Name" dc="1-20"\]/);
  assert.match(prompt, /when uncertainty or the player's actions should be resolved mechanically\./);
  assert.match(prompt, /Abandon positivity bias/);
  assert.match(prompt, /Do NOT include rolls\/modifier\/total\/result/);
  assert.doesNotMatch(prompt, /Legacy fallback:/);
  assert.doesNotMatch(prompt, /\bused=/);
  assert.doesNotMatch(prompt, /\bmode=/);
});

test("GM format reminder uses sparse skill_check tag echoing player d20 when a dice roll was submitted", () => {
  const prompt = buildGmFormatReminder({
    gameActiveState: "exploration",
    sessionNumber: 1,
    partyNames: ["Aster"],
    playerName: "Mari",
    playerDiceRollSubmitted: true,
  });

  assert.match(prompt, /\[skill_check: skill="Skill Name" dc="1-20" rolls="player's d20 result"\]/);
  assert.match(prompt, /engine applies the player's attribute modifier on top of the rolled number/);
  assert.match(prompt, /do NOT compute or invent rolls\/modifier\/total\/result fields/);
});

test("GM format reminder separates HUD widget updates from durable stats", () => {
  const prompt = buildGmFormatReminder({
    gameActiveState: "exploration",
    sessionNumber: 1,
    partyNames: ["Aster"],
    playerName: "Mari",
    hudWidgets: [
      {
        id: "party_bonds",
        label: "Party Bonds",
        type: "stat_block",
        position: "hud_left",
        config: { stats: [{ name: "Aster", value: 50 }] },
      },
    ],
  });

  assert.match(prompt, /emit widget commands for every real change to these visible HUD widgets/);
  assert.match(prompt, /Do not skip a changed widget just because another system tracks related player or party stats/);
  assert.match(prompt, /HUD widgets are visual UI state only/);
  assert.match(prompt, /party member HP, party relationships, and other durable game facts remain in their own canonical systems/);
});

test("session conclusion prompt combines summary progression and cards in one JSON shape", () => {
  const promptWithCards = buildSessionConclusionPrompt({ language: "Polish", includeCharacterCards: true });
  const promptWithoutCards = buildSessionConclusionPrompt({ includeCharacterCards: false });

  assert.match(
    promptWithCards,
    /exactly these top-level keys and no others: summary, campaignProgression, characterCards\./,
  );
  assert.match(
    promptWithCards,
    /summary must be an object with exactly these keys and no others: summary, resumePoint, partyDynamics, partyState, keyDiscoveries, characterMoments, littleDetails, npcUpdates, statsSnapshot\./,
  );
  assert.match(promptWithCards, /key events in 2-4 paragraphs/);
  assert.match(promptWithCards, /summary\.littleDetails/);
  assert.match(
    promptWithCards,
    /campaignProgression must be an object with exactly these keys and no others: storyArc, plotTwists, partyArcs\./,
  );
  assert.match(promptWithCards, /Return every supplied character exactly once, even if unchanged\./);
  assert.match(promptWithCards, /Language: write every natural-language value in Polish\./);
  assert.match(
    promptWithoutCards,
    /characterCards must be an empty JSON array because no current character cards were supplied\./,
  );
});

test("recap prompt includes the stored resume point and the final narrated beat", () => {
  const prompt = buildRecapPrompt(
    [
      makeSummary({
        sessionNumber: 4,
        summary: "The party escaped the citadel and reached the collapsing skybridge.",
        resumePoint: "Resume with the party stranded on the collapsing skybridge as alarms ring.",
        partyDynamics: "The party finally trusted each other under pressure.",
        keyDiscoveries: ["The regent controls the warding engine."],
      }),
    ],
    "[Narrator] The last cable snaps and the bridge pitches sideways.",
  );

  assert.match(prompt, /Resume point: Resume with the party stranded on the collapsing skybridge as alarms ring\./);
  assert.match(prompt, /The final narrated beat immediately before the session ended was:/);
  assert.match(prompt, /The last cable snaps and the bridge pitches sideways\./);
});
