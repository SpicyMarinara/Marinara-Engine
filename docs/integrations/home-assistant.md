# Marinara Engine — Home Assistant Integration

[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)

Connects [Marinara Engine](https://github.com/Pasta-Devs/Marinara-Engine) to Home Assistant so your AI characters can control real-world devices — lights, climate, locks, covers, media players, and more — directly from chat, roleplay, and game sessions.

## How it works

Marinara Engine supports **custom webhook tools**: when the AI decides to call a tool during generation, it POSTs to a webhook URL and feeds the result back to the language model. This integration:

1. Registers a private webhook endpoint inside Home Assistant
2. Creates all selected tool definitions in Marinara, pre-filled with that webhook URL
3. Creates a **Home Assistant agent** in Marinara that lists every HA tool in its enabled tools — making them appear in the chat's Function Calling picker automatically

```
Marinara AI  →  calls tool ha_turn_on  →  POST /api/webhook/<id>  →  HA turns on light
Marinara AI  ←  {"result": "Turned on light.living_room"}          ←  HA responds
```

Everything happens on first startup. You never copy URLs or configure tools manually.

## Requirements

- Home Assistant 2024.1 or newer
- [HACS](https://hacs.xyz) installed
- [Marinara Engine](https://github.com/Pasta-Devs/Marinara-Engine) running locally (default: `localhost:3000`)

## Installation

### 1. Add to HACS

1. Open HACS → three-dot menu → **Custom repositories**
2. URL: `https://github.com/Pasta-Devs/Marinara-Engine`
3. Category: **Integration**
4. Click **Add**, then search for **Marinara Engine** and install it
5. Restart Home Assistant

### 2. Add the integration

1. Go to **Settings → Devices & Services → Add Integration**
2. Search for **Marinara Engine**
3. Enter the host and port where Marinara Engine is running (default: `localhost` / `3000`)
4. Click **Submit**

On startup, the integration automatically:

- Registers a webhook inside Home Assistant
- Creates all tool definitions in Marinara → **Settings → Custom Tools**
- Creates a **Home Assistant** agent in Marinara → **Agents** with every HA tool already enabled

### 3. Done

Open any chat in Marinara. Your AI characters can now turn on lights, adjust the thermostat, play music, and more — they'll do it naturally as the narrative calls for it, without you having to prompt for it explicitly.

## Configuration

After setup, open the integration's **Configure** menu to:

- Set a **Primary Chat** — the default target for `send_message` and `trigger_generation` HA services
- Choose **Exposed Tool Categories** — select which categories of HA tools Marinara can use (locks are off by default)

Changes to the category selection take effect after pressing **Marinara Sync HA Tools** or restarting Home Assistant.

## Entities

| Entity                      | Type   | Description                                        |
| --------------------------- | ------ | -------------------------------------------------- |
| Marinara Chat Count         | Sensor | Total number of chats                              |
| Marinara Active Agent Count | Sensor | Number of globally enabled agents                  |
| Marinara Active Chat        | Select | Choose which chat HA services target               |
| Marinara Agent: _name_      | Switch | Enable / disable each AI agent globally            |
| Marinara Abort Generation   | Button | Cancel any in-flight AI generation                 |
| Marinara Sync HA Tools      | Button | Re-sync all tool definitions and agent to Marinara |

## Tool categories

You can choose which categories to expose in the integration's **Configure** menu. Locks are off by default.

| Category                 | Tools                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Lights & Switches        | `ha_turn_on`, `ha_turn_off`, `ha_toggle`, `ha_set_brightness`, `ha_set_color`, `ha_set_color_temp` |
| Climate                  | `ha_set_temperature`, `ha_set_hvac_mode`                                                           |
| Covers (Blinds & Garage) | `ha_open_cover`, `ha_close_cover`, `ha_set_cover_position`                                         |
| Locks                    | `ha_lock`, `ha_unlock`                                                                             |
| Media Players            | `ha_media_play`, `ha_media_pause`, `ha_set_volume`                                                 |
| Scenes & Scripts         | `ha_activate_scene`, `ha_run_script`                                                               |
| Query & Generic          | `ha_get_state`, `ha_list_entities`, `ha_call_service`, `ha_notify`                                 |

## The Home Assistant agent

On first sync the integration creates a **Home Assistant** agent in Marinara (visible under **Agents**). This agent:

- Runs in **parallel** during every generation turn
- Has all enabled HA tools listed in its Function Calling settings
- Carries a prompt that instructs the AI to act on smart home cues naturally — dimming lights when a character reaches for the switch, adjusting the thermostat when the temperature comes up in conversation, and so on

The agent is kept in sync automatically — pressing **Sync HA Tools** after changing the enabled categories will update the agent's tool list in place. No manual deletion needed.

## HA Services

Use these in automations to interact with Marinara from Home Assistant's side.

### `marinara_engine.send_message`

Send a message to a Marinara chat.

| Field                | Required | Description                                  |
| -------------------- | -------- | -------------------------------------------- |
| `message`            | Yes      | Message content                              |
| `chat_id`            | No       | Target chat ID (defaults to primary chat)    |
| `role`               | No       | `user` / `assistant` / `system` / `narrator` |
| `trigger_generation` | No       | Also trigger an AI response (default: false) |

**Example — notify the AI when someone arrives:**

```yaml
automation:
  trigger:
    platform: state
    entity_id: binary_sensor.front_door
    to: "on"
  action:
    service: marinara_engine.send_message
    data:
      message: "Someone just arrived at the front door."
      trigger_generation: true
```

### `marinara_engine.trigger_generation`

Start an AI generation turn in a chat.

| Field          | Required | Description                               |
| -------------- | -------- | ----------------------------------------- |
| `chat_id`      | No       | Target chat ID (defaults to primary chat) |
| `user_message` | No       | Optional user message to include          |

## Re-syncing tools

Press **Marinara Sync HA Tools** on the integration's device page to push any missing tools and recreate the agent if it was deleted. Tools that already exist are skipped — it's safe to press at any time.

## Troubleshooting

**Tools not appearing in Marinara's Custom Tools**
Press **Marinara Sync HA Tools**, or restart Home Assistant. Verify under **Settings → Custom Tools** in Marinara.

**Home Assistant agent not showing up in Marinara**
Press **Marinara Sync HA Tools**. If it's already in the Agents list but not visible in a chat, it may be disabled — enable it there.

**Tools not available in a chat's Function Calling picker**
The **Home Assistant** agent must be enabled in Marinara (Agents list). If it's there but disabled, enable it. If it's missing entirely, press **Sync HA Tools** to recreate it.

**Webhook calls failing**
Check that Home Assistant is reachable from the machine running Marinara Engine. If they run on the same machine, the internal URL (`http://localhost:8123`) is used automatically. If Marinara runs on a different device, make sure HA's local network URL is accessible from that device.

**Cannot connect on setup**
Make sure Marinara Engine is running (`pnpm dev` or the packaged app) and the host/port you entered match where it's actually listening (default: `localhost:3000`).

**Finding the webhook URL manually**
Go to **Settings → Devices & Services → Marinara Engine** in HA. The webhook ID is stored in the config entry. The full URL follows the pattern:

```
http://<homeassistant-ip>:8123/api/webhook/<webhook-id>
```

Each tool in Marinara's Custom Tools list already has this URL set.
