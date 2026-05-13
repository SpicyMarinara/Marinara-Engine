import test from "node:test";
import assert from "node:assert/strict";
import { parseCharacterCommands, parseDirectMessageCommands } from "../src/services/conversation/character-commands.js";

test("parses create_character with expanded card fields", () => {
  const { commands, cleanContent } = parseCharacterCommands(
    `[create_character: name="Luna", description="A fortune teller", appearance="Silver hair", backstory="Raised by wolves", mes_example="<START> Welcome", creator_notes="Keep it eerie", system_prompt="Stay cryptic", post_history_instructions="Mention the moon", creator="Mari", character_version="2.1", tags="mystic, seer", alternate_greetings="Hello there || Another seeker?", talkativeness=0.75, fav=true, world="Velvet Bazaar", depth_prompt="Remember the prophecy", depth_prompt_depth=6, depth_prompt_role="assistant"]`,
  );

  assert.equal(cleanContent, "");
  assert.deepEqual(commands, [
    {
      type: "create_character",
      name: "Luna",
      description: "A fortune teller",
      appearance: "Silver hair",
      backstory: "Raised by wolves",
      mesExample: "<START> Welcome",
      creatorNotes: "Keep it eerie",
      systemPrompt: "Stay cryptic",
      postHistoryInstructions: "Mention the moon",
      creator: "Mari",
      characterVersion: "2.1",
      tags: ["mystic", "seer"],
      alternateGreetings: ["Hello there", "Another seeker?"],
      talkativeness: 0.75,
      fav: true,
      world: "Velvet Bazaar",
      depthPrompt: "Remember the prophecy",
      depthPromptDepth: 6,
      depthPromptRole: "assistant",
    },
  ]);
});

test("parses update_character with the expanded safe text fields", () => {
  const { commands, cleanContent } = parseCharacterCommands(
    `[update_character: name="Luna", backstory="Raised by wolves", appearance="Silver hair", mes_example="<START> hi", creator_notes="Use with roleplay", system_prompt="Stay eerie", post_history_instructions="Keep replies short"]`,
  );

  assert.equal(cleanContent, "");
  assert.deepEqual(commands, [
    {
      type: "update_character",
      name: "Luna",
      backstory: "Raised by wolves",
      appearance: "Silver hair",
      mesExample: "<START> hi",
      creatorNotes: "Use with roleplay",
      systemPrompt: "Stay eerie",
      postHistoryInstructions: "Keep replies short",
    },
  ]);
});

test("parses assistant update text fields with escaped quotes and newlines", () => {
  const { commands, cleanContent } = parseCharacterCommands(
    `[update_character: name="Luna", description="She goes by \\"The Bread Witch\\" and everyone knows it.", scenario="First paragraph\\n\\nSecond paragraph"]` +
      `[update_persona: name="Alex Storm", description="Known as \\"The Anchor\\"", backstory="Line one\\nLine two"]`,
  );

  assert.equal(cleanContent, "");
  assert.deepEqual(commands, [
    {
      type: "update_character",
      name: "Luna",
      description: 'She goes by "The Bread Witch" and everyone knows it.',
      scenario: "First paragraph\n\nSecond paragraph",
    },
    {
      type: "update_persona",
      name: "Alex Storm",
      description: 'Known as "The Anchor"',
      backstory: "Line one\nLine two",
    },
  ]);
});

test("parses assistant update fields delimited by smart quotes", () => {
  const { commands, cleanContent } = parseCharacterCommands(
    `[update_character: name=“Luna”, description=“She says ‘hi’ — then writes alternate greetings.”, alternate_greetings=““Hello” — warm || ‘Goodnight’ — soft”]`,
  );

  assert.equal(cleanContent, "");
  assert.deepEqual(commands, [
    {
      type: "update_character",
      name: "Luna",
      description: "She says ‘hi’ — then writes alternate greetings.",
      alternateGreetings: ["“Hello” — warm", "‘Goodnight’ — soft"],
    },
  ]);
});

test("keeps adjacent assistant command parsing stable with escaped characters", () => {
  const { commands } = parseCharacterCommands(
    `[create_character: name="Luna", first_message="She said \\"hello\\". Path C:\\\\Moon", tags="mystic, seer", alternate_greetings="Hi || Hello"]` +
      `[update_character: name="Luna", system_prompt="", depth_prompt_role="system"]`,
  );

  assert.deepEqual(commands, [
    {
      type: "create_character",
      name: "Luna",
      firstMessage: 'She said "hello". Path C:\\Moon',
      tags: ["mystic", "seer"],
      alternateGreetings: ["Hi", "Hello"],
    },
    {
      type: "update_character",
      name: "Luna",
      systemPrompt: "",
      depthPromptRole: "system",
    },
  ]);
});

test("parses update_persona with scenario and backstory", () => {
  const { commands, cleanContent } = parseCharacterCommands(
    `[update_persona: name="Alex Storm", scenario="Urban fantasy city", backstory="Former detective"]`,
  );

  assert.equal(cleanContent, "");
  assert.deepEqual(commands, [
    {
      type: "update_persona",
      name: "Alex Storm",
      scenario: "Urban fantasy city",
      backstory: "Former detective",
    },
  ]);
});

test("parses create_lorebook JSON block and strips it from visible text", () => {
  const { commands, cleanContent } = parseCharacterCommands(
    `I'll make that lorebook now.\n<create_lorebook>{"name":"Arcadia World Lore","description":"Setting notes","category":"world","tags":["fantasy"],"entries":[{"name":"Silver Court","content":"The Silver Court rules the north.","keys":["Silver Court","north"],"tag":"faction","constant":false}]}</create_lorebook>`,
  );

  assert.equal(cleanContent, "I'll make that lorebook now.");
  assert.deepEqual(commands, [
    {
      type: "create_lorebook",
      name: "Arcadia World Lore",
      description: "Setting notes",
      category: "world",
      tags: ["fantasy"],
      entries: [
        {
          name: "Silver Court",
          content: "The Silver Court rules the north.",
          description: undefined,
          keys: ["Silver Court", "north"],
          secondaryKeys: undefined,
          tag: "faction",
          constant: false,
          selective: undefined,
        },
      ],
    },
  ]);
});

test("parses update_lorebook JSON block and strips it from visible text", () => {
  const { commands, cleanContent } = parseCharacterCommands(
    `I'll refine that lorebook.\n<update_lorebook>{"name":"Arcadia World Lore","description":"","tags":["fantasy","revised"],"entries":[{"matchName":"Silver Court","name":"Silver Court","content":"The Silver Court rules the northern border through old pacts.","keys":["Silver Court","northern border"],"tag":"faction","constant":true},{"name":"Moon Gate","content":"The Moon Gate opens only during eclipses.","keys":["Moon Gate"]}]}</update_lorebook>`,
  );

  assert.equal(cleanContent, "I'll refine that lorebook.");
  assert.deepEqual(commands, [
    {
      type: "update_lorebook",
      name: "Arcadia World Lore",
      newName: undefined,
      description: "",
      category: undefined,
      tags: ["fantasy", "revised"],
      entries: [
        {
          name: "Silver Court",
          matchName: "Silver Court",
          content: "The Silver Court rules the northern border through old pacts.",
          description: undefined,
          keys: ["Silver Court", "northern border"],
          secondaryKeys: undefined,
          tag: "faction",
          constant: true,
          selective: undefined,
        },
        {
          name: "Moon Gate",
          matchName: undefined,
          content: "The Moon Gate opens only during eclipses.",
          description: undefined,
          keys: ["Moon Gate"],
          secondaryKeys: undefined,
          tag: undefined,
          constant: undefined,
          selective: undefined,
        },
      ],
    },
  ]);
});

test("parses loose selfie command context variants", () => {
  const { commands, cleanContent } = parseCharacterCommands(
    `Here you go. [selfie] [selfie: context="rainy kitchen"] [selfie: "new dress"] [selfie: sleepy morning hair]`,
  );

  assert.equal(cleanContent, "Here you go.");
  assert.deepEqual(commands, [
    { type: "selfie", context: undefined },
    { type: "selfie", context: "rainy kitchen" },
    { type: "selfie", context: "new dress" },
    { type: "selfie", context: "sleepy morning hair" },
  ]);
});

test("parses roleplay direct-message commands without exposing them in visible text", () => {
  const { commands, cleanContent } = parseDirectMessageCommands(
    `He glances down at the glowing screen. [dm: character="Dottore" message="come to the lab when you can"] The moment passes.`,
  );

  assert.equal(cleanContent, "He glances down at the glowing screen.  The moment passes.");
  assert.deepEqual(commands, [
    {
      type: "dm",
      character: "Dottore",
      message: "come to the lab when you can",
    },
  ]);
});

test("parses mixed legacy and expanded update_character fields together", () => {
  const { commands } = parseCharacterCommands(
    `[update_character: name="Luna", description="A fortune teller", personality="enigmatic", first_message="Hello", scenario="Moonlit shop", appearance="Dark velvet dress", system_prompt="Be cryptic"]`,
  );

  assert.deepEqual(commands, [
    {
      type: "update_character",
      name: "Luna",
      description: "A fortune teller",
      personality: "enigmatic",
      firstMessage: "Hello",
      scenario: "Moonlit shop",
      appearance: "Dark velvet dress",
      systemPrompt: "Be cryptic",
    },
  ]);
});

test("strips update commands while preserving visible assistant text", () => {
  const { commands, cleanContent } = parseCharacterCommands(
    `I'll tune those cards for you.\n[update_character: name="Luna", backstory="Raised by wolves"]\n[update_persona: name="Alex Storm", scenario="Urban fantasy city"]\nAnything else?`,
  );

  assert.equal(commands.length, 2);
  assert.equal(cleanContent, "I'll tune those cards for you.\n\nAnything else?");
});

test("parses empty-string updates so assistant commands can clear fields", () => {
  const { commands } = parseCharacterCommands(
    `[update_character: name="Luna", backstory="", appearance="", mes_example="", creator_notes="", system_prompt="", post_history_instructions="", tags="", alternate_greetings="", world="", depth_prompt=""][update_persona: name="Alex Storm", scenario="", backstory=""]`,
  );

  assert.deepEqual(commands, [
    {
      type: "update_character",
      name: "Luna",
      backstory: "",
      appearance: "",
      mesExample: "",
      creatorNotes: "",
      systemPrompt: "",
      postHistoryInstructions: "",
      tags: [],
      alternateGreetings: [],
      world: "",
      depthPrompt: "",
    },
    {
      type: "update_persona",
      name: "Alex Storm",
      scenario: "",
      backstory: "",
    },
  ]);
});
