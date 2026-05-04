# Generation Parameters

Marinara's chat modes (Conversation, Roleplay, Visual Novel, Game) all use a shared set of generation parameters per LLM connection. These control how the model samples responses — temperature, top-p, max tokens, and so on — and live in each connection's settings under **Settings → Connections → edit a connection → Generation Parameters**.

This is the canonical reference. Mode-specific guides reference this doc rather than repeating the table.

## Defaults

Generation parameters are **layered**. The effective parameters for a chat at runtime come from (in order of increasing precedence):

1. **The preset attached to the chat.** New presets start from a shared baseline, `DEFAULT_GENERATION_PARAMS` in `packages/shared/src/constants/defaults.ts`.
2. **Mode-specific runtime defaults.** Some modes inject preferred defaults at request time, ahead of connection/chat overrides:
   - **Scene chats** (forked Roleplay scenes) preset `maxTokens: 8192`, `reasoningEffort: "maximum"`, `verbosity: "high"` before user overrides apply.
   - **Game Mode** injects optimized defaults intended for the world-gen / structured-JSON workload — `temperature: 1`, `maxTokens: 16384`, `topP: 1`, `topK: 0`, both penalties at `0`, `reasoningEffort: "maximum"`. These can still be overridden if a user explicitly sets the field at the connection or chat level. Local Gemma models bypass these and just get a `maxTokens` floor of `16384`.
3. **The connection's `defaultParameters`**, settable when editing a connection. Wins over both the preset baseline and any mode-specific defaults for fields the user explicitly set.
4. **Per-chat overrides**, settable in the chat's settings drawer or via the wizard's "Customize generation parameters" toggle. Highest precedence.

### Preset baseline (`DEFAULT_GENERATION_PARAMS`)

What every new preset starts from:

| Parameter          | Default  | Notes                                                                                                                                |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `temperature`      | `1`      | Higher = more variety; lower = more deterministic. See Claude notes below.                                                           |
| `maxTokens`        | `4096`   | Cap on response length. Game Mode world-gen in particular benefits from `10000` or higher because the structured JSON output is large. |
| `topP`             | `1`      | See Claude notes below.                                                                                                              |
| `topK`             | `0`      | Disabled; most providers ignore it anyway.                                                                                           |
| `minP`             | `0`      | Disabled.                                                                                                                            |
| `frequencyPenalty` | `0`      |                                                                                                                                      |
| `presencePenalty`  | `0`      |                                                                                                                                      |
| `reasoningEffort`  | `null`   | When set, used by reasoning-capable models (Claude with extended thinking, OpenAI o-series). `null` = provider default.              |
| `verbosity`        | `null`   | When set, used by GPT-5-family models. `null` = provider default.                                                                    |
| `assistantPrefill` | `""`     | Optional text to prefill into the assistant's response. Most users leave empty.                                                      |
| `customParameters` | `{}`     | Provider-specific overrides for parameters Marinara doesn't expose by default.                                                       |
| `maxContext`       | `128000` | Max context window in tokens. Connections typically override this with their actual model's context window.                          |

### Wizard customization starting points

When you toggle **Customize generation parameters** in the chat setup wizard, the editor prefills slightly different starting values depending on the mode (defined in `packages/client/src/components/ui/GenerationParametersEditor.tsx`):

- **`CHAT_PARAMETER_DEFAULTS`** (Conversation wizard): differs from the baseline by setting `reasoningEffort: "maximum"` and `verbosity: "high"`.
- **`ROLEPLAY_PARAMETER_DEFAULTS`** (Roleplay / Visual Novel / Game wizards): same as `CHAT_PARAMETER_DEFAULTS` except `maxTokens` is `8192` instead of `4096`, since these modes typically render richer narrative output.

These wizard defaults only matter if you actually enable the customization toggle — they prefill the editor. If you leave the toggle off, no per-chat override is saved and the connection's existing parameters apply.

## Tuning

Most users don't need to change these. If you do:

- **Output feels stilted or repetitive:** raise `temperature` slightly (e.g. `1.1` to `1.3`).
- **Output feels chaotic or off-task:** lower `temperature` (e.g. `0.7` to `0.9`).
- **Output gets cut off mid-sentence or mid-JSON:** raise `maxTokens`.
- **A character keeps repeating phrasing across turns:** raise `frequencyPenalty` or `presencePenalty` slightly (e.g. `0.3` to `0.6`).

For ongoing chat or roleplay turns, `temperature` somewhere in the `0.8`–`1.0` range tends to feel balanced — but this is rule of thumb, not a tested recommendation. Different models respond differently; what works on one connection may not transfer.

## Per-backend gotchas

- **Claude direct (Anthropic provider)** — Marinara's Anthropic provider doesn't include `top_p` in its requests at all, so the temperature/top_p conflict doesn't arise on this route. For **Opus 4.7+** models specifically, the provider also strips `temperature` and `top_k` from the request because those models reject sampling parameters entirely — the UI sliders exist but have no effect.

- **Claude via OpenRouter or an OpenAI-compatible endpoint** — for most Claude models (Sonnet, Haiku, older Opus), the engine sends both `temperature` and `topP` when both are set, and Claude's API rejects this combination with `Bad Request: temperature and top_p cannot both be specified for this model`. On these routes, leave one of `temperature` and `topP` unset (not at its default value — actually unset). Save and retry. For **Opus 4.7+** specifically, the engine recognizes the model and strips all sampling params automatically (matching the Anthropic-direct behavior), so no manual action is needed for that one model family.

- **Claude thinking mode** — when extended thinking is enabled, the engine strips `temperature` from the request to satisfy Claude's constraint that sampler params can't combine with extended thinking. `presencePenalty` and `frequencyPenalty` aren't native Claude sampling parameters and don't typically have effect on Claude. Output behavior is shaped primarily by `reasoningEffort` and model choice; tuning samplers in this configuration may produce no observable change.

- **OpenRouter auto-routing** — sampler behavior depends on the underlying model your route resolves to. If you're using `openrouter/auto`, `openrouter/free`, or any other auto-routing model, your sampler settings may behave inconsistently between calls because the underlying model can change. Pinning a specific model keeps behavior predictable.

## Found this confusing? Tell us

Same channels as the rest of the user docs — [join the Discord](https://discord.com/invite/KdAkTg94ME) or [open a GitHub issue](https://github.com/Pasta-Devs/Marinara-Engine/issues) if a parameter behavior didn't match what's described here, or if your provider has a sampler quirk that should be added.
