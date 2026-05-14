import { useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle, Sparkles, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/utils";

interface HomeFaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  bullets?: string[];
}

const QUICK_FIXES = [
  "Raise max response length if agents, trackers, or Lorebook Keeper keep failing or returning broken JSON.",
  "Update before digging too deep. If you installed from Git, use the updater or the Advanced settings update check.",
  "If the installer or startup scripts vanished, check antivirus quarantine first and whitelist the Marinara folder.",
  "If Game Mode setup keeps failing, switch to a stronger model before changing prompts or presets.",
];

const HOME_FAQ_ITEMS: HomeFaqItem[] = [
  {
    id: "game-mode-model",
    category: "Top Issue",
    question: "What model should I use for Game Mode?",
    answer: "Game Mode is much pickier than regular chat, especially during first generation and session setup.",
    bullets: [
      "Use a strong model for setup and major GM turns: Claude Opus, Gemini 3 Pro, GPT-5.x, or a similarly strong frontier model.",
      "Gemma 4 31B also holds up surprisingly well if you want a local option.",
      "GLM, DeepSeek, Kimi, and weaker models are more likely to produce malformed JSON, weak formatting, or low-quality GM output.",
    ],
  },
  {
    id: "agent-max-length",
    category: "Top Issue",
    question: "My trackers, Lorebook Keeper, or agents do nothing or fail with a max length error. What fixes that?",
    answer:
      "The most common fix is increasing max response length so the model can finish the tracker JSON instead of truncating it.",
    bullets: [
      "Raise max response length in your connection or chat Advanced Settings.",
      "If an agent keeps breaking formatting, move it to a stronger model, especially Gemma 4 or another reliable structured-output model.",
      "If a bad cached turn keeps poisoning results, copy your last user message, delete that turn and anything after it, then resend.",
    ],
  },
  {
    id: "sidecar-cpu-fallback",
    category: "Top Issue",
    question: "I saw '[sidecar] Startup with max GPU offload failed, retrying with CPU fallback'. Is that normal?",
    answer:
      "Usually yes. Marinara's local sidecar is meant to live on CPU and RAM so your main RP model can keep the GPU and VRAM.",
    bullets: [
      "A fallback message does not automatically mean anything is broken.",
      "The sidecar is there for helpers and utility tasks, not to compete with your main model for VRAM.",
      "Treat it as a problem only if the sidecar never recovers or keeps crashing instead of settling on CPU fallback.",
    ],
  },
  {
    id: "antivirus-installer",
    category: "Setup",
    question: "My antivirus flagged the installer or deleted files. Is Marinara safe?",
    answer: "This is a very common false-positive path for installers and batch files that spawn local services.",
    bullets: [
      "Add the Marinara folder to your antivirus exclusions before reinstalling or restoring files.",
      "Bitdefender and Windows Defender are the most common sources of quarantines here.",
      "Restoring the quarantined files and rerunning usually fixes the issue.",
      "If you want a second opinion, compare the release files against a VirusTotal report rather than trusting a single AV popup.",
    ],
  },
  {
    id: "blank-page-localhost",
    category: "Setup",
    question: "I get a blank page or ERR_EMPTY_RESPONSE on localhost:7860. What should I try?",
    answer: "This is usually a browser state problem rather than a dead install.",
    bullets: [
      "Try localhost:7860 instead of 127.0.0.1, or the reverse if you already used localhost.",
      "Hard refresh with Ctrl+Shift+R and clear the site's local storage.",
      "Test in incognito or a different browser.",
      "Docker and Podman users hit the same symptom, so browser cleanup is still worth trying there too.",
    ],
  },
  {
    id: "update-without-installer",
    category: "Setup",
    question: "How do I update without the installer?",
    answer: "The updater expects a real Git checkout.",
    bullets: [
      "If you downloaded a ZIP, it does not contain the .git history the updater needs.",
      "Either reinstall from the supported path or initialize Git properly before trying to update in place.",
      "You can also use Settings > Advanced > Check for Updates when your install already has Git metadata.",
    ],
  },
  {
    id: "android-apk-termux",
    category: "Setup",
    question: "Is the Android APK standalone?",
    answer: "No. The APK is only a WebView shell for Marinara Engine running locally in Termux.",
    bullets: [
      "Install Termux from F-Droid and run Marinara with ./start-termux.sh first.",
      "The APK opens the same-device local server at 127.0.0.1, so it cannot work if Termux is closed.",
      "If it stays on the connection screen, go back to Termux and start the server.",
    ],
  },
  {
    id: "pnpm-install-bat",
    category: "Setup",
    question: "'pnpm: not found' or install.bat failed. What now?",
    answer: "Your system usually just does not have pnpm available yet.",
    bullets: [
      "Install pnpm globally with npm install -g pnpm, or use the EXE installer if you want the guided path.",
      "On Android or Termux, a long pause at Corepack alignment is a recurring pain point rather than a special Marinara-only error.",
      "If Termux hangs specifically on 'Aligning pnpm via Corepack', let it finish before assuming it is dead.",
    ],
  },
  {
    id: "google-cloud-credit",
    category: "Connections",
    question: "Can I use Google Cloud's free credit with Marinara?",
    answer: "Usually yes, but not every Google route behaves the same.",
    bullets: [
      "Newer AI Studio API accounts have tighter limitations, so Vertex is the safer route.",
      "If you prefer a relay, BYOK through OpenRouter is another common workaround.",
    ],
  },
  {
    id: "best-local-model",
    category: "Connections",
    question: "What is the best local model right now?",
    answer: "Gemma 4 is still the safest recommendation for most local users.",
    bullets: [
      "If you can fit it, go for dense 31B. Otherwise the MoE 26B A3B tier is the next best bet.",
      "Q4 and better quants are usually the sweet spot.",
      "Very small E2B or E4B class models are fine for helpers and sidecars, but not ideal for serious RP.",
    ],
  },
  {
    id: "bigger-agent-model",
    category: "Connections",
    question: "How do I use a bigger model for agents instead of the local sidecar?",
    answer:
      "Create a normal connection to your own Kobold, llama.cpp, or compatible endpoint and mark it for agent use.",
    bullets: [
      "The switch lives on the connection itself.",
      "Once enabled, agents can use that remote model instead of the local sidecar path.",
    ],
  },
  {
    id: "reverse-proxy",
    category: "Connections",
    question: "How do I use Claude Code or a reverse proxy?",
    answer: "There is no separate reverse-proxy field like SillyTavern uses.",
    bullets: [
      "Point a Custom or Anthropic-style connection directly at your local proxy URL, usually something like http://localhost:PORT/v1.",
      "If your proxy relies on account-based OAuth flows, expect them to be less stable than API-key setups.",
    ],
  },
  {
    id: "nanogpt-401",
    category: "Connections",
    question: "NanoGPT is throwing 401 errors. Why does recreating the connection help?",
    answer: "That has been one of the more reliable fixes for NanoGPT-specific auth weirdness.",
    bullets: [
      "Delete the broken connection and recreate it from scratch instead of endlessly editing the existing one.",
      "Some users only got rid of the 401 loop after remaking even the default NanoGPT connection.",
    ],
  },
  {
    id: "sampler-settings",
    category: "Core",
    question: "Where do I change temperature, top-p, and other sampler settings?",
    answer: "Open a chat, then use the right panel's Advanced Settings.",
    bullets: [
      "That is where you adjust temperature, top-p, max response length, and similar generation settings.",
      "Use Set Default if you want those values to become the saved defaults for that connection.",
    ],
  },
  {
    id: "enable-agents",
    category: "Core",
    question: "How do I enable agents?",
    answer: "The answer depends on the mode.",
    bullets: [
      "In Roleplay mode, open Chat Settings and go to the Agents section for that chat.",
      "In Game Mode, most agents run in the background automatically. The user-facing toggles are mainly for scene analysis and image generation.",
    ],
  },
  {
    id: "macro-list",
    category: "Core",
    question: "Where is the list of supported macros?",
    answer: "Type /macros directly in chat.",
    bullets: [
      "Marinara uses SillyTavern-style {{char}} and {{user}} macros.",
      "If you tried {{charName}} or {{userName}}, that mismatch is why it failed.",
    ],
  },
  {
    id: "same-character-chats",
    category: "Core",
    question: "How do I switch between different chats with the same character?",
    answer: "Use Recent Chats from the home screen or the branch-aware chat browser inside the app.",
    bullets: [
      "Chats with the same character are organized as branches rather than one giant flat thread.",
      "The branch selector at the top of the chat bar is the quickest in-chat way to jump between them now.",
    ],
  },
  {
    id: "where-data-lives",
    category: "Core",
    question: "Where are my chats, presets, and other data stored?",
    answer: "The main local database lives in packages/server/data/marinara-engine.db.",
    bullets: [
      "That is the file power users usually back up or inspect when they want direct access.",
      "Most of the 'where is X stored' questions end up there.",
    ],
  },
  {
    id: "hide-message-from-prompt",
    category: "Core",
    question: "How do I hide a message from the prompt without deleting it?",
    answer: "Open the message actions and use the eyeball icon.",
    bullets: ["That hides the message from prompt assembly without wiping it from the visible chat history."],
  },
  {
    id: "sillytavern-import",
    category: "Core",
    question: "How does SillyTavern import behave?",
    answer: "Most data imports cleanly, but there are a few recurring gotchas.",
    bullets: [
      "Regex scripts still need to be imported separately.",
      "Character chats can sometimes end up merged under one unused-style branch during messy imports.",
      "Editing older imported multi-line character messages can still feel quirky, so treat that path carefully.",
    ],
  },
  {
    id: "prose-guardian-user-voice",
    category: "Agents",
    question: "Prose Guardian is impersonating me or writing the whole reply. Is that normal?",
    answer: "No. That is usually a weak agent-model problem, not what the agent is supposed to do.",
    bullets: [
      "Move your agents to a stronger model such as Gemma 4 if possible.",
      "If the bad behavior seems cached into the thread, copy the last user message, delete it and everything after it, then resend.",
    ],
  },
  {
    id: "attribute-scale",
    category: "Agents",
    question: "What counts as high or low for attribute stats?",
    answer:
      "The default expectation is basically DnD-style 1 to 20, but the model still interprets the fiction around it.",
    bullets: ["Think of 10-ish as ordinary and 18 to 20 as exceptional unless your setup says otherwise."],
  },
  {
    id: "narrative-director-captures-messages",
    category: "Agents",
    question: "Narrative Director is capturing my messages and bot replies inside itself. Why?",
    answer: "That has shown up most often with weaker or unstable model choices, especially GLM 5.1 style runs.",
    bullets: ["Switch the agent to a stronger model before rewriting prompts."],
  },
  {
    id: "comfyui-illustrator-setup",
    category: "Images",
    question: "How do I get ComfyUI or Illustrator working?",
    answer: "The workflow template has to expose the placeholders Marinara expects.",
    bullets: [
      "Use %prompt%, %width%, %height%, %negative_prompt%, and %seed% in the workflow or request template.",
      'If your JSON parser complains, wrap width and height placeholders in quotes, like "%width%".',
      "The default timeout is 120 seconds, which is often too short for slower Flux or Chroma workflows.",
    ],
  },
  {
    id: "image-resolution",
    category: "Images",
    question: "How do I change image resolution?",
    answer: "Set it on the image-generation connection itself.",
    bullets: ["Newer versions expose width and height in the connection panel rather than hiding it in a prompt."],
  },
  {
    id: "temp-must-be-1",
    category: "Images",
    question: "I got a 'Temp must be 1' error while using Illustrate. Which temperature is wrong?",
    answer: "Usually the image connection, not your main chat model.",
    bullets: ["Check the image-generation connection's temperature field first."],
  },
  {
    id: "booru-prompts",
    category: "Images",
    question: "How do I get booru-style prompts from Illustrator?",
    answer: "Edit the Illustrator agent prompt in the Agents section.",
    bullets: ["That is where you steer the prompt format rather than fighting the image connection settings."],
  },
  {
    id: "character-sprites",
    category: "Images",
    question: "How do I generate character sprites?",
    answer: "Open the character card and use the sprite generation flow from there.",
    bullets: ["You still need a working image-generation connection before the button becomes useful."],
  },
  {
    id: "game-invalid-json",
    category: "Game Mode",
    question: "Game Mode first generation failed with invalid JSON. How do I stabilize it?",
    answer: "Start by upgrading the model before changing anything else.",
    bullets: [
      "A strong GM model is the main fix here.",
      "If you are using Opus and still need extra help, add something like 'Ultrathink. Return structured JSON with no markdown code fences.' to the additional GM notes.",
    ],
  },
  {
    id: "game-editability",
    category: "Game Mode",
    question: "Can I edit widgets, scenes, or journal-like Game Mode data after the fact?",
    answer: "Some of that is editable now, but not every auto-tracked piece is equally exposed yet.",
    bullets: [
      "Inventory, readables, and more session-level continuity details are much more editable than they used to be.",
      "Some auto-tracked journal sections are still more rigid than users expect.",
    ],
  },
  {
    id: "game-party-members",
    category: "Game Mode",
    question: "Can I add new party members mid-game?",
    answer: "Yes. Marinara can recruit party members during an active game now.",
    bullets: [
      "If some portraits or tracker details lag behind after recruiting someone new, refresh or regenerate the related asset rather than assuming the recruit failed.",
    ],
  },
  {
    id: "game-background",
    category: "Game Mode",
    question: "How do I change the Game Mode background?",
    answer: "The quickest path is usually to talk to the GM directly or rerun the scene or image pass for that beat.",
    bullets: [
      "Game backgrounds are tied to scene analysis and asset generation, so background changes often follow that pipeline rather than a single permanent toggle.",
    ],
  },
  {
    id: "talk-to-gm",
    category: "Game Mode",
    question: "Can I talk to the GM directly instead of playing in-character?",
    answer: "Yes. Switch into GM chat mode when you need direct out-of-scene help.",
    bullets: [
      "That is the easiest way to ask for lorebook updates, map changes, UI adjustments, or scene-management help without pretending it is an in-world action.",
    ],
  },
  {
    id: "session-summary",
    category: "Game Mode",
    question: "Does ending a session summarize it and let me continue later?",
    answer: "Yes. Ending a session generates continuity data and the next session can resume from that state later.",
    bullets: ["The session-end flow is meant to preserve a usable recap, not just close the chat."],
  },
  {
    id: "content-filtering",
    category: "Misc",
    question: "Is there built-in content filtering?",
    answer:
      "Not as a separate Marinara safety layer. Filtering behavior mostly depends on the model or provider you connect.",
  },
  {
    id: "shared-gpu",
    category: "Misc",
    question: "Can I run RP and image generation on the same GPU?",
    answer: "Sometimes, but VRAM is the hard limit.",
    bullets: [
      "It is possible on tighter setups, but image generation plus a big RP model is one of the fastest ways to hit a wall.",
    ],
  },
  {
    id: "mobile-app",
    category: "Misc",
    question: "Is there a mobile app?",
    answer:
      "Not as a standalone app yet. You can install Marinara as a PWA from the browser on phones and tablets while the server runs on your computer, Docker host, or Termux device.",
  },
  {
    id: "tts-support",
    category: "Misc",
    question: "Does Marinara support TTS?",
    answer: "Yes. There is built-in support for OpenAI-compatible TTS providers now.",
    bullets: [
      "Set it up from the Connections area and the TTS settings card.",
      "If you expected older advice saying TTS was extension-only, that is out of date now.",
    ],
  },
  {
    id: "translations",
    category: "Misc",
    question: "Can I chat in languages other than English? What about the UI?",
    answer: "Chat content works in other languages, but the UI itself is still English-first.",
    bullets: ["Non-English chats are fine.", "UI translations are still limited, though contributions are welcome."],
  },
  {
    id: "bug-reports",
    category: "Misc",
    question: "Where should I report bugs or request features?",
    answer: "Use the dedicated bug and feedback channel in Discord rather than dropping reports into general chat.",
    bullets: [
      "The home screen already links you to the Discord server.",
      "Using the proper report channel makes it much easier for maintainers to tag and follow up on problems.",
    ],
  },
];

const CATEGORY_STYLES: Record<string, string> = {
  "Top Issue": "border-rose-400/30 bg-rose-500/12 text-rose-700 dark:text-rose-200",
  Setup: "border-amber-400/30 bg-amber-500/12 text-amber-700 dark:text-amber-200",
  Connections: "border-cyan-400/30 bg-cyan-500/12 text-cyan-700 dark:text-cyan-200",
  Core: "border-emerald-400/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-200",
  Agents: "border-violet-400/30 bg-violet-500/12 text-violet-700 dark:text-violet-200",
  Images: "border-fuchsia-400/30 bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-200",
  "Game Mode": "border-orange-400/30 bg-orange-500/12 text-orange-700 dark:text-orange-200",
  Misc: "border-[var(--border)] bg-[var(--muted)]/30 text-[var(--muted-foreground)]",
};

export function HomeFaq() {
  const [expanded, setExpanded] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>("game-mode-model");

  return (
    <section className="w-full max-w-md">
      <div className="overflow-hidden rounded-[1rem] border border-[var(--border)]/60 bg-[var(--card)] shadow-[0_14px_38px_rgba(0,0,0,0.24)] backdrop-blur-xl dark:bg-[linear-gradient(180deg,rgba(18,14,23,0.92),rgba(11,10,16,0.86))]">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5 sm:items-center sm:gap-3 sm:px-4"
          aria-expanded={expanded}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--primary)]/25 bg-[linear-gradient(135deg,rgba(235,137,81,0.18),rgba(77,229,221,0.14))] text-[var(--primary)] shadow-[0_0_20px_rgba(235,137,81,0.1)]">
            <HelpCircle size="1rem" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold tracking-tight text-[var(--foreground)]">Professor Mari&apos;s FAQ</p>
              <span className="rounded-full border border-[var(--border)]/60 bg-black/5 px-2 py-0.5 text-[0.5625rem] uppercase tracking-[0.16em] text-[var(--muted-foreground)]/80 dark:bg-white/6">
                {HOME_FAQ_ITEMS.length} answers
              </span>
            </div>
            <p className="mt-0.5 text-[0.6875rem] leading-snug text-[var(--muted-foreground)]/80">
              The recurring setup, model, Game Mode, image, and agent questions people keep asking.
            </p>
          </div>
          <ChevronDown
            size="1rem"
            className={cn(
              "shrink-0 text-[var(--muted-foreground)] transition-transform duration-200",
              expanded && "rotate-180 text-[var(--primary)]",
            )}
          />
        </button>

        {expanded && (
          <div className="border-t border-[var(--border)]/60 px-4 pb-4 pt-3">
            <div className="rounded-[1.1rem] border border-[var(--primary)]/20 bg-[linear-gradient(135deg,rgba(235,137,81,0.12),rgba(77,229,221,0.08))] p-3.5 shadow-[0_10px_26px_rgba(0,0,0,0.18)] sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="mx-auto flex h-28 w-20 shrink-0 items-start justify-center overflow-hidden rounded-[1.25rem] border border-[var(--border)] bg-[var(--card)]/80 shadow-[0_10px_24px_rgba(0,0,0,0.22)] sm:mx-0 sm:h-32 sm:w-24">
                  <img
                    src="/sprites/mari/Mari_explaining.png"
                    alt="Professor Mari"
                    className="h-full w-full object-cover object-[center_14%]"
                  />
                </div>
                <div className="min-w-0 text-center sm:text-left">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--muted)]/50 px-2.5 py-1 text-[0.5625rem] uppercase tracking-[0.18em] text-[var(--muted-foreground)]/85 dark:border-white/10 dark:bg-black/20">
                    <Sparkles size="0.6875rem" />
                    Professor Mari
                  </div>
                  <p className="mt-2 text-sm font-semibold tracking-tight text-[var(--foreground)]">
                    Start here before you go hunting through Discord logs.
                  </p>
                  <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]/85">
                    The biggest repeat problems are Game Mode model choice, silent agent failures from low max response
                    length, and confusion about the local sidecar using CPU instead of the GPU.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-[1.1rem] border border-amber-400/20 bg-amber-500/8 p-3">
              <div className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-200/90">
                <TriangleAlert size="0.875rem" />
                Before You Post A Bug
              </div>
              <ul className="mt-2 space-y-1.5 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]/88">
                {QUICK_FIXES.map((fix) => (
                  <li key={fix} className="flex gap-2">
                    <span className="mt-[0.18rem] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/75 dark:bg-amber-300/75" />
                    <span>{fix}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-3">
              <div className="mb-2 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <p className="text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-[var(--muted-foreground)]/65">
                  Frequently Asked Questions
                </p>
                <p className="text-[0.625rem] text-[var(--muted-foreground)]/50">
                  Tap a question to reveal the answer.
                </p>
              </div>

              <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-0.5 sm:max-h-[28rem] sm:pr-1">
                {HOME_FAQ_ITEMS.map((item) => {
                  const isOpen = openItemId === item.id;

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "overflow-hidden rounded-[1rem] border border-[var(--border)]/55 bg-[var(--card)]/45 transition-colors",
                        isOpen && "border-[var(--primary)]/30 bg-[var(--card)]/70 shadow-[0_8px_24px_rgba(0,0,0,0.18)]",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenItemId((current) => (current === item.id ? null : item.id))}
                        className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        aria-expanded={isOpen}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "shrink-0 rounded-full border px-2 py-0.5 text-[0.5625rem] font-medium uppercase tracking-[0.16em]",
                                CATEGORY_STYLES[item.category] ?? CATEGORY_STYLES.Misc,
                              )}
                            >
                              {item.category}
                            </span>
                            <span className="min-w-0 text-[0.75rem] font-medium leading-relaxed text-[var(--foreground)]">
                              {item.question}
                            </span>
                          </div>
                        </div>
                        {isOpen ? (
                          <ChevronDown size="0.9375rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
                        ) : (
                          <ChevronRight size="0.9375rem" className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" />
                        )}
                      </button>

                      {isOpen && (
                        <div className="border-t border-[var(--border)]/55 bg-[var(--muted)]/30 px-3 py-3 dark:bg-black/10">
                          <p className="text-[0.72rem] leading-relaxed text-[var(--foreground)]/92">{item.answer}</p>
                          {item.bullets?.length ? (
                            <ul className="mt-2 space-y-1.5 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]/85">
                              {item.bullets.map((bullet) => (
                                <li key={bullet} className="flex gap-2">
                                  <span className="mt-[0.18rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]/70" />
                                  <span>{bullet}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
