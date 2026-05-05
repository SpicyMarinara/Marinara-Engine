# Frequently Asked Questions

---

<a id="how-do-i-access-marinara-engine-from-my-phone-or-another-device"></a>

<details>
<summary><strong>How do I access Marinara Engine from my phone or another device?</strong></summary>
<br>

If Marinara Engine is running on one device (your PC, a server, etc.) and you want to use it from a phone, tablet, or another computer on the same network:

## 1. Make sure the server is bound to all interfaces

The shell launchers (`start.sh`, `start.bat`, `start-termux.sh`) already bind to `0.0.0.0` by default. If you started manually with `pnpm start`, set `HOST=0.0.0.0` in your `.env` file first. See the [Configuration Reference](CONFIGURATION.md) for details.

## 2. Configure access control

Loopback (`127.0.0.1`) works without a password, but other devices on your LAN now require authentication by default. Set `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` in `.env`, then restart Marinara. For privileged actions from that browser, also set `ADMIN_SECRET` and save it in **Settings -> Advanced -> Admin Access**.

You can restore the old unauthenticated LAN behavior with `ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK=true`, but only do this on a network you fully trust. For a step-by-step walkthrough covering Basic Auth, IP Allowlist, and the private-network bypass, see [Remote Access — Setting Up Basic Auth or an IP Allowlist](REMOTE_ACCESS.md).

## 3. Find your host device's local IP address

| Platform | Command                                                                 |
| -------- | ----------------------------------------------------------------------- |
| Windows  | `ipconfig` → look for **IPv4 Address**                                  |
| macOS    | System Settings → Wi-Fi → your network, or run `ipconfig getifaddr en0` |
| Linux    | `hostname -I` or `ip addr`                                              |
| Android  | Settings → Wi-Fi → tap your network to see the IP                       |

### 4. Open a browser on the other device

Navigate to:

```
http://<host-ip>:7860
```

For example: `http://192.168.1.42:7860`

## 5. (Optional) Install the PWA

Most mobile browsers will offer an **"Add to Home Screen"** or **"Install App"** prompt, giving you a more native app experience without browser chrome.

### Not on the same network?

Tools like [Tailscale](https://tailscale.com/) give each device a stable IP address on a private overlay network, so you can access Marinara Engine from anywhere without exposing it to the public internet.

### Still not connecting?

- Verify both devices are on the same Wi-Fi network.
- Confirm `HOST=0.0.0.0` and Basic Auth credentials are set on the server.
- Check that no firewall is blocking the configured port (default `7860`).
- See the [Troubleshooting](TROUBLESHOOTING.md#app-not-loading-on-mobile--another-device) page for more help.

### Using the Spotify DJ agent on a LAN install?

Spotify's OAuth rules only allow `https://` or `http://127.0.0.1` redirect URIs, so the agent editor will show a `127.0.0.1` URI even when you're accessing Marinara from another device. Either put the server behind HTTPS or use the paste-back fallback in the agent editor — both flows are covered in [Spotify DJ login fails on a remote or LAN install](TROUBLESHOOTING.md#spotify-dj-login-fails-on-a-remote-or-lan-install).

</details>

---

<details>
<summary><strong>Which AI providers are supported?</strong></summary>
<br>

Marinara Engine supports a wide range of LLM and image generation providers:

- **LLM:** OpenAI, Anthropic, Anthropic via Claude Pro / Max subscription (through the local Claude Agent SDK), Google, OpenRouter, NanoGPT, Mistral, Cohere, Pollinations, Together AI, NovelAI, and any custom OpenAI-compatible endpoint (Ollama, LM Studio, KoboldCpp, etc.)
- **Image generation:** Stability AI, ComfyUI, AUTOMATIC1111 / SD Web UI, and providers that support image output through their chat API

You can configure multiple connections at once and assign different providers per chat. API keys are encrypted at rest with AES-256.

</details>

---

<a id="why-doesnt-my-roleplay-character-remember-the-messages-from-our-connected-conversation"></a>

<details>
<summary><strong>Why doesn't my roleplay character remember the messages from our connected conversation?</strong></summary>
<br>

Connected chats (the link between a conversation and a roleplay or game) are intentionally **asymmetric** in how context flows:

**Roleplay → Conversation (automatic):** the roleplay's summary and recent messages are pulled into the conversation's context every turn, so DM characters always know what's happening in the story. Roleplay characters can also break the fourth wall back into the DM by wrapping text in `<ooc>...</ooc>` tags.

**Conversation → Roleplay (manual, via tags):** the conversation's raw messages are _not_ injected into the roleplay. To bridge content the other direction, the conversation character uses one of two OOC tags:

- `<influence>...</influence>` — one-shot steer for the _next_ roleplay turn, then consumed.
- `<note>...</note>` — durable; appears on every roleplay turn until you clear it from the chat settings drawer. Use this for facts the roleplay character should keep remembering.

This is by design — pulling raw DM messages into every roleplay turn would inflate the prompt and dilute the story. If you want something from the DM to stick in the roleplay, ask the conversation character to wrap it in a `<note>`.

</details>

---

<a id="how-do-i-use-one-lorebook-with-multiple-characters"></a>

<details>
<summary><strong>How do I use one lorebook with multiple characters, or scope it to a specific chat?</strong></summary>
<br>

Marinara has three different ways to scope a lorebook, each at a different level. Pick whichever matches your use case:

**1. Bind a lorebook to one character or persona** (lorebook editor → `Linked Character` / `Linked Persona`).

The lorebook auto-activates in any chat that includes that character or uses that persona. Best when the lore is specifically _about_ that character (e.g., their backstory, their world). The two link types are mutually exclusive — pick one or the other, not both. Each link is single-value, so this is the right tool for one lorebook ↔ one character.

**2. Attach lorebooks per-chat via the chat settings drawer** (gear icon → **Lorebooks** section → **+ Add Lorebook**).

Multi-select. Use this when you want one lorebook active across multiple characters, or scoped to just one specific chat, or when you want several lorebooks layered together for a single chat. The lorebook's `Linked Character` / `Linked Persona` fields can be empty for this — chat attachment is independent of those links.

**3. Filter individual entries by character** (lorebook entry editor → `Character Filters`).

Inside a single shared lorebook, you can mark each entry as only firing when specific characters (or character tags) are present in the chat. Best for a "world bible" lorebook shared across many chats where some entries are character-specific.

**Common scenario — "I want this lorebook for Character A _and_ Character B":** leave the lorebook's character link empty, and attach the lorebook via the chat settings drawer in any chat that includes either character. The same lorebook can be attached to as many chats as you want.

</details>

---

<a id="what-happens-if-i-enable-an-agent-and-also-have-similar-instructions-in-my-preset"></a>

<details>
<summary><strong>What happens if I enable an agent and also have similar instructions in my preset?</strong></summary>
<br>

Both contribute to the prompt, but in different ways: a preset section is static text concatenated every turn, while an agent runs at request time and produces its own output. If both target the same behavior, the model receives both — usually redundant, occasionally conflicting, and always extra tokens.

Common overlaps to watch for:

- Writing-style or anti-repetition directives in the preset and the **Prose Guardian** agent.
- "Track time / weather / location" instructions and the **World State** agent.
- "Track character mood / outfit / stats" instructions and the **Character Tracker** agent.
- Quest-tracking, combat-mechanics, or persona-stat instructions and their respective agents.
- HTML/CSS visual-styling prompts and the **Immersive HTML** agent.
- "Summarize past events" instructions and the **Automated Chat Summary** agent.

**The general rule:** pick one place to express each behavior. If you've enabled an agent that covers a behavior, you can usually remove the matching preset directive. If you'd rather keep your preset version (e.g., it's tuned for a particular character), disable the corresponding agent.

**One important exception:** the `agent_data` marker section, and the `{{agent::TYPE}}` macro, are the _intended_ way to thread an agent's output into a specific spot in the preset. That's wiring, not overlap — several agents (World State, Quest Tracker, Character Tracker, and others) set this up for you by default. The pattern to avoid is hand-writing preset sections that duplicate an agent's _behavior_, not using the marker section that carries the agent's _output_.

</details>
