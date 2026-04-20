# Title: Universal Agent Tool Support
## Status: Draft
## Goals:
- Enable all agents (built-in and custom) to use tools if they have `enabledTools` in their settings.
- Remove the hardcoded "Spotify-only" tool support in the generation pipeline.
- Ensure that every agent in the pipeline correctly receives its tool definitions and execution context based on its configuration.

## Problem Statement
Currently, the generation pipeline (`packages/server/src/routes/generate.routes.ts`) contains a hardcoded block that explicitly looks for an agent of type `spotify`. If it finds one, it attaches a `toolContext` (the logic that allows it to use functions). For all other agents (built-in or custom), the server simply ignores their tool configuration and sends them into the pipeline as "batchable" (text-only) agents. As a result, no agent other than `spotify` can execute any tools, even if tools are enabled in the UI.

## Proposed Solution:
- **`packages/server/src/routes/generate.routes.ts`**:
    - Relocate the resolution of tool definitions (`builtInFiltered` and `customFiltered`) to an earlier point in the `generate` route, before the agent pipeline loop starts.
    - Instead of checking only for `spotify`, iterate over all `resolvedAgents`.
    - For each agent, check its settings for `enabledTools` (or use defaults from `DEFAULT_AGENT_TOOLS`).
    - If the agent has tools enabled, filter the available `toolDefs` to match its allowed list.
    - Construct and attach a `toolContext` to the agent, containing the matched tool definitions and an `executeToolCall` function.
    - Ensure compatibility with existing Spotify token-refresh logic by keeping the Spotify credentials extraction but decoupling it from the general tool assignment.
    - **Crucially:** Do *not* modify the underlying `executeToolCalls` signature in `tool-executor.ts`. The context interface remains unchanged. This change is strictly about orchestration and enablement.