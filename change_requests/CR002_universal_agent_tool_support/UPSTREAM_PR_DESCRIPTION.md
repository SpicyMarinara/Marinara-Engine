# CR002 Universal Agent Tool Support - Upstream PR Description

## Why this change

### Problem statement

The generation pipeline previously only attached function-calling support to the built-in Spotify agent. Other built-in and custom agents could have `enabledTools` configured, but they were still treated as text-only agents in the pipeline and executed as `batchable`.

This meant non-Spotify agents could not actually invoke tools during their turn, even when tool usage was configured for that agent.

### Solution

This change generalizes agent tool support in `generate.routes.ts`.

When chat-level tools are enabled, the route now resolves tool definitions once, filters them per agent allowlist, and attaches `toolContext` to any resolved agent with active tools. This preserves chat-level tool gating while enabling both built-in and custom agents to use tools correctly.

## What changed

### Core changes

- `generate.routes.ts`
  - moved tool definition and custom-tool resolution earlier in the request flow
  - removed the hardcoded Spotify-only tool assignment path
  - added universal per-agent `toolContext` attachment for resolved agents with allowed tools
  - kept chat-level tool enablement as the master gate for all tool use in the request
  - reused a single Spotify credential resolution path and only resolves/refershes Spotify credentials when Spotify tools are actually relevant to the request
  - added server-side filtering for main-generation tool calls so only allowed tools are executed
  - added server-side allowlist enforcement for agent tool calls
  - hardened custom tool registration by rejecting duplicate tool names and skipping invalid parameter schemas safely

- `agent-pipeline.ts`
  - improved diagnostics so pipeline logs distinguish `batchable` agents from `tool-using` agents

- `agent-executor.ts`
  - added `[agent-tools]` diagnostics for tool invocation and completion
  - gated raw args/results behind `DEBUG_AGENTS=true`
  - redacts and truncates debug payload logging

## Validation

- [x] `pnpm check`
- [x] Manual verification completed

### Manual verification notes

- Custom-agent tool path:
  - configured a custom test agent with `roll_dice` enabled
  - confirmed the pipeline now reports the agent as `tool-using` instead of `batchable`
  - confirmed the agent successfully invoked `roll_dice` and received the JSON result for the follow-up model turn

- Spotify regression check:
  - confirmed the Spotify DJ agent still executes through the tool loop
  - confirmed successful invocation of `spotify_get_playlist_tracks`, `spotify_play`, and `spotify_set_volume`
  - confirmed the earlier regression where Spotify tool execution stopped before playback is no longer present

- Logging verification:
  - confirmed normal logs show tool invocation/completion with the `[agent-tools]` tag
  - confirmed debug mode (`DEBUG_AGENTS=true`) includes redacted/truncated tool args and results

### Before / after evidence

Before:

```text
[agent-pipeline] executeGroup: 1 batchable, 0 tool-using [ 'custom-test-agent' ]
```

After:

```text
[agent-pipeline] executeGroup: 0 batchable, 1 tool-using { batch: [], tools: [ 'custom-test-agent' ] }
[agent-tools] custom-test-agent calling: roll_dice
[agent-tools] custom-test-agent roll_dice completed
```

## Docs and release impact

- [x] No user-facing docs changes needed
- [ ] Updated docs (README / CONTRIBUTING / android/README / CHANGELOG) as needed
- [ ] Version/release files updated (only if this PR includes a version bump)

## UI evidence

Not applicable.

## Additional notes

- This PR intentionally keeps chat-level tool enablement as the master switch.
- Agent `enabledTools` determines the subset of tools an agent may use once tools are enabled for the chat.
- The change-request documents used during implementation are intended to be removed before the final upstream PR.
