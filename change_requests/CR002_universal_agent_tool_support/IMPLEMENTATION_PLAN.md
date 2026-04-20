# Implementation Plan: Universal Agent Tool Support
## Prerequisites:
- A clear understanding that no changes to `packages/server/src/services/tools/tool-executor.ts` are required.
- The change is strictly to the orchestration layer.

## Step-by-Step Tasks:
1. Create directory `change_requests/CR002_universal_agent_tool_support`.
2. Write `HLD.md` and `IMPLEMENTATION_PLAN.md` for `CR002`.
3. Create git branch `change/CR002-universal_agent_tool_support`.
4. Modify `packages/server/src/routes/generate.routes.ts`:
    - Move the block that resolves `toolDefs` and `customToolDefs` earlier in the generation route, placing it before the creation of the `AgentPipeline`.
    - Retain the `spotifyAgent` token refresh logic.
    - Add a loop that iterates over all `resolvedAgents`.
    - In the loop, extract the agent's `enabledTools` from its settings or `DEFAULT_AGENT_TOOLS`.
    - If tools are enabled for the agent, filter `toolDefs` based on the enabled tools list.
    - If matching tools are found, attach a `toolContext` to the agent, providing the `executeToolCall` function.
    - Ensure `executeToolCalls` receives the existing minimal context (e.g., `spotifyCreds`).
5. Run `pnpm check` to verify all type changes and linting.

## Files Affected:
- `packages/server/src/routes/generate.routes.ts`

## Verification:
- Manual test: Assign a tool (like `roll_dice`) to a custom agent and verify that the logs show it as "tool-using" rather than "batchable".
- Type check: `pnpm check` must pass without errors.

## Rollback:
- `git checkout main`.
- Delete the feature branch `change/CR002-universal_agent_tool_support`.
