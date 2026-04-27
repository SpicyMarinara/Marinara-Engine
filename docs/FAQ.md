# Frequently Asked Questions

---

<a id="how-do-i-access-marinara-engine-from-my-phone-or-another-device"></a>

<details>
<summary><strong>How do I access Marinara Engine from my phone or another device?</strong></summary>
<br>

If Marinara Engine is running on one device (your PC, a server, etc.) and you want to use it from a phone, tablet, or another computer on the same network:

#### 1. Make sure the server is bound to all interfaces

The shell launchers (`start.sh`, `start.bat`, `start-termux.sh`) already bind to `0.0.0.0` by default. If you started manually with `pnpm start`, set `HOST=0.0.0.0` in your `.env` file first. See the [Configuration Reference](CONFIGURATION.md) for details.

#### 2. Find your host device's local IP address

| Platform | Command                                                                 |
| -------- | ----------------------------------------------------------------------- |
| Windows  | `ipconfig` → look for **IPv4 Address**                                  |
| macOS    | System Settings → Wi-Fi → your network, or run `ipconfig getifaddr en0` |
| Linux    | `hostname -I` or `ip addr`                                              |
| Android  | Settings → Wi-Fi → tap your network to see the IP                       |

#### 3. Open a browser on the other device

Navigate to:

```
http://<host-ip>:7860
```

For example: `http://192.168.1.42:7860`

#### 4. (Optional) Install the PWA

Most mobile browsers will offer an **"Add to Home Screen"** or **"Install App"** prompt, giving you a more native app experience without browser chrome.

#### Not on the same network?

Tools like [Tailscale](https://tailscale.com/) give each device a stable IP address on a private overlay network, so you can access Marinara Engine from anywhere without exposing it to the public internet.

#### Still not connecting?

- Verify both devices are on the same Wi-Fi network.
- Check that no firewall is blocking the configured port (default `7860`).
- See the [Troubleshooting](TROUBLESHOOTING.md#app-not-loading-on-mobile--another-device) page for more help.

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
