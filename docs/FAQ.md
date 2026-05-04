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

You can restore the old unauthenticated LAN behavior with `ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK=true`, but only do this on a network you fully trust.

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
