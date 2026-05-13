import assert from "node:assert/strict";
import test from "node:test";
import { safeGeneratedAssetSlug } from "../src/services/game/game-asset-generation.js";

test("generated asset slugs stay under platform filename limits", () => {
  const longSceneSlug =
    "story defining moment of intimate emotional recognition akari s deliberate disobedience rewarded hassan s possessive desire deepened power dynamics established the song performance is the emotional and narrative climax of this scene where vulnerability becomes weaponized intimacy";
  const slug = safeGeneratedAssetSlug(longSceneSlug, { suffix: "mp3ckuzn" });
  const filename = `${slug}.png`;

  assert.equal(Buffer.byteLength(filename, "utf8") <= 255, true);
  assert.equal(slug.endsWith("-mp3ckuzn"), true);
  assert.match(slug, /-[a-f0-9]{8}-mp3ckuzn$/);
});

test("generated asset slugs keep short readable names unchanged", () => {
  assert.equal(safeGeneratedAssetSlug("Dark Forest Clearing", { suffix: "abc123" }), "dark-forest-clearing-abc123");
});
