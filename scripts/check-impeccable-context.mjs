import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const skillPath = resolve(root, ".agents/skills/impeccable/SKILL.md");
const loaderPath = resolve(root, ".agents/skills/impeccable/scripts/load-context.mjs");
const failures = [];
const warnings = [];

if (!existsSync(skillPath)) {
  failures.push("Missing .agents/skills/impeccable/SKILL.md. Run `npx -y skills add pbakaus/impeccable --yes`.");
}

if (!existsSync(loaderPath)) {
  failures.push("Missing Impeccable context loader at .agents/skills/impeccable/scripts/load-context.mjs.");
}

let context = null;
if (failures.length === 0) {
  const result = spawnSync(process.execPath, [loaderPath], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const errorMessage = result.error?.message ? ` (${result.error.message})` : "";
    failures.push(stderr || `Impeccable context loader failed${errorMessage}.`);
  } else {
    try {
      context = JSON.parse(result.stdout);
    } catch {
      failures.push("Impeccable context loader did not return valid JSON.");
    }
  }
}

if (context) {
  const product = typeof context.product === "string" ? context.product : "";
  if (!context.hasProduct || product.trim().length < 200 || /\[TODO\]/i.test(product)) {
    failures.push("PRODUCT.md is missing, too short, or still contains TODO markers. Run `$impeccable teach`.");
  }

  const registerMatch = product.match(/## Register\s+([\s\S]*?)(?:\n## |\n?$)/i);
  const register = registerMatch?.[1]?.trim().toLowerCase();
  if (register !== "brand" && register !== "product") {
    failures.push("PRODUCT.md must include `## Register` with either `brand` or `product`.");
  }

  if (!context.hasDesign) {
    warnings.push(
      "DESIGN.md is missing. Run `$impeccable document` when you want visual-system checks to be stricter.",
    );
  }
}

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`);
}

if (failures.length > 0) {
  console.error("Impeccable context check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Impeccable context check passed.");
