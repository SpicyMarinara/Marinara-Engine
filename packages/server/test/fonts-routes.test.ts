import test from "node:test";
import assert from "node:assert/strict";
import { fontDisplayName, isLegacyManagedGoogleFilename, parseGoogleFontFaces } from "../src/routes/fonts.routes.js";

test("parseGoogleFontFaces keeps unicode-range shards for CJK fonts", () => {
  const css = `
@font-face {
  font-family: 'Noto Sans SC';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/notosanssc/v40/chinese.woff2) format('woff2');
  unicode-range: U+4E00-9FFF;
}
@font-face {
  font-family: 'Noto Sans SC';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/notosanssc/v40/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`;

  assert.deepEqual(parseGoogleFontFaces(css), [
    {
      url: "https://fonts.gstatic.com/s/notosanssc/v40/chinese.woff2",
      weight: "400",
      style: "normal",
      unicodeRange: "U+4E00-9FFF",
    },
    {
      url: "https://fonts.gstatic.com/s/notosanssc/v40/latin.woff2",
      weight: "400",
      style: "normal",
      unicodeRange: "U+0000-00FF",
    },
  ]);
});

test("fontDisplayName collapses Google font shard filenames to one family", () => {
  assert.equal(fontDisplayName("NotoSansSC-Regular-001.woff2"), "Noto Sans SC");
  assert.equal(fontDisplayName("NotoSansSC-Regular-099.woff2"), "Noto Sans SC");
});

test("isLegacyManagedGoogleFilename matches app-generated Google font filenames", () => {
  assert.equal(isLegacyManagedGoogleFilename("NotoSansSC-Regular.woff2", "NotoSansSC"), true);
  assert.equal(isLegacyManagedGoogleFilename("NotoSansSC-Regular-001.woff2", "NotoSansSC"), true);
  assert.equal(isLegacyManagedGoogleFilename("NotoSansSC-Regular-abc.woff2", "NotoSansSC"), false);
  assert.equal(isLegacyManagedGoogleFilename("NotoSansSC-Bold.woff2", "NotoSansSC"), false);
  assert.equal(isLegacyManagedGoogleFilename("Other-Regular.woff2", "NotoSansSC"), false);
});
