"""Constants for the Marinara Engine integration."""

DOMAIN = "marinara_engine"

DEFAULT_HOST = "localhost"
DEFAULT_PORT = 3000
SCAN_INTERVAL = 30  # seconds

CONF_HOST = "host"
CONF_PORT = "port"
CONF_WEBHOOK_ID = "webhook_id"
CONF_PRIMARY_CHAT_ID = "primary_chat_id"
CONF_ENABLED_CATEGORIES = "enabled_categories"

TOOL_CATEGORIES: dict[str, str] = {
    "lights": "Lights & Switches",
    "climate": "Climate",
    "covers": "Covers (Blinds & Garage)",
    "locks": "Locks",
    "media": "Media Players",
    "scenes_scripts": "Scenes & Scripts",
    "query": "Query & Generic",
}

# Locks excluded by default — users can opt in via Options
DEFAULT_ENABLED_CATEGORIES: list[str] = [
    "lights",
    "climate",
    "covers",
    "media",
    "scenes_scripts",
    "query",
]

# Each tool carries a "category" key matching TOOL_CATEGORIES above.
TOOL_DEFINITIONS = [
    # ------------------------------------------------------------------ lights
    {
        "name": "ha_turn_on",
        "category": "lights",
        "description": (
            "Turn on a Home Assistant entity or all entities of a given domain in an area. "
            "Provide entity_id for a single entity, or area_name (+ optional domain, default 'light') "
            "to turn on everything in a room at once."
        ),
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Entity ID to turn on, e.g. light.living_room",
                },
                "area_name": {
                    "type": "string",
                    "description": "Area name to target, e.g. Büro. Turns on all entities of the given domain in that area.",
                },
                "domain": {
                    "type": "string",
                    "description": "Domain to target when using area_name (default: light), e.g. light, switch, fan",
                },
            },
        },
    },
    {
        "name": "ha_turn_off",
        "category": "lights",
        "description": (
            "Turn off a Home Assistant entity or all entities of a given domain in an area. "
            "Provide entity_id for a single entity, or area_name (+ optional domain, default 'light')."
        ),
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Entity ID to turn off",
                },
                "area_name": {
                    "type": "string",
                    "description": "Area name to target, e.g. Büro",
                },
                "domain": {
                    "type": "string",
                    "description": "Domain to target when using area_name (default: light)",
                },
            },
        },
    },
    {
        "name": "ha_toggle",
        "category": "lights",
        "description": (
            "Toggle a Home Assistant entity or all entities of a given domain in an area. "
            "Provide entity_id for a single entity, or area_name (+ optional domain, default 'light')."
        ),
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Entity ID to toggle",
                },
                "area_name": {
                    "type": "string",
                    "description": "Area name to target, e.g. Büro",
                },
                "domain": {
                    "type": "string",
                    "description": "Domain to target when using area_name (default: light)",
                },
            },
        },
    },
    {
        "name": "ha_set_brightness",
        "category": "lights",
        "description": "Set the brightness of a light or all lights in an area",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Light entity ID"},
                "area_name": {"type": "string", "description": "Area name to target all lights in that room"},
                "brightness_pct": {
                    "type": "number",
                    "description": "Brightness as a percentage from 0 to 100",
                },
            },
            "required": ["brightness_pct"],
        },
    },
    {
        "name": "ha_set_color",
        "category": "lights",
        "description": "Set the RGB color of a light or all lights in an area",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Light entity ID"},
                "area_name": {"type": "string", "description": "Area name to target all lights in that room"},
                "r": {"type": "number", "description": "Red component 0-255"},
                "g": {"type": "number", "description": "Green component 0-255"},
                "b": {"type": "number", "description": "Blue component 0-255"},
            },
            "required": ["r", "g", "b"],
        },
    },
    {
        "name": "ha_set_color_temp",
        "category": "lights",
        "description": "Set the color temperature of a light or all lights in an area",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Light entity ID"},
                "area_name": {"type": "string", "description": "Area name to target all lights in that room"},
                "kelvin": {
                    "type": "number",
                    "description": "Color temperature in Kelvin, e.g. 2700 for warm white, 6500 for cool daylight",
                },
            },
            "required": ["kelvin"],
        },
    },
    # ----------------------------------------------------------------- climate
    {
        "name": "ha_set_temperature",
        "category": "climate",
        "description": "Set the target temperature on a climate device or all climate devices in an area",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Climate entity ID"},
                "area_name": {"type": "string", "description": "Area name to target all climate devices in that room"},
                "temperature": {
                    "type": "number",
                    "description": "Target temperature in the unit configured in Home Assistant",
                },
            },
            "required": ["temperature"],
        },
    },
    {
        "name": "ha_set_hvac_mode",
        "category": "climate",
        "description": "Set the HVAC mode of a climate device or all climate devices in an area",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Climate entity ID"},
                "area_name": {"type": "string", "description": "Area name to target all climate devices in that room"},
                "hvac_mode": {
                    "type": "string",
                    "description": "HVAC mode: off, heat, cool, heat_cool, auto, dry, fan_only",
                },
            },
            "required": ["hvac_mode"],
        },
    },
    # ------------------------------------------------------------------ covers
    {
        "name": "ha_open_cover",
        "category": "covers",
        "description": "Open a cover or all covers in an area (blinds, garage door, curtains, etc.)",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Cover entity ID, e.g. cover.living_room_blinds",
                },
                "area_name": {"type": "string", "description": "Area name to open all covers in that room"},
            },
        },
    },
    {
        "name": "ha_close_cover",
        "category": "covers",
        "description": "Close a cover or all covers in an area (blinds, garage door, curtains, etc.)",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Cover entity ID"},
                "area_name": {"type": "string", "description": "Area name to close all covers in that room"},
            },
        },
    },
    {
        "name": "ha_set_cover_position",
        "category": "covers",
        "description": "Set the position of a cover or all covers in an area",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Cover entity ID"},
                "area_name": {"type": "string", "description": "Area name to set position for all covers in that room"},
                "position": {
                    "type": "number",
                    "description": "Position from 0 (closed) to 100 (open)",
                },
            },
            "required": ["position"],
        },
    },
    # ------------------------------------------------------------------- locks
    {
        "name": "ha_lock",
        "category": "locks",
        "description": "Lock a lock entity",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Lock entity ID, e.g. lock.front_door",
                },
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "ha_unlock",
        "category": "locks",
        "description": "Unlock a lock entity",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Lock entity ID"},
                "code": {"type": "string", "description": "Optional unlock code"},
            },
            "required": ["entity_id"],
        },
    },
    # ------------------------------------------------------------------- media
    {
        "name": "ha_media_play",
        "category": "media",
        "description": "Play media on a media player",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Media player entity ID"},
                "media_content_id": {
                    "type": "string",
                    "description": "URL or identifier of the media to play (optional)",
                },
                "media_content_type": {
                    "type": "string",
                    "description": "Type of media: music, tvshow, movie, playlist (optional)",
                },
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "ha_media_pause",
        "category": "media",
        "description": "Pause a media player",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Media player entity ID"},
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "ha_set_volume",
        "category": "media",
        "description": "Set the volume of a media player",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Media player entity ID"},
                "volume_level": {
                    "type": "number",
                    "description": "Volume level from 0.0 to 1.0",
                },
            },
            "required": ["entity_id", "volume_level"],
        },
    },
    # ---------------------------------------------------------- scenes/scripts
    {
        "name": "ha_activate_scene",
        "category": "scenes_scripts",
        "description": "Activate a Home Assistant scene",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Scene entity ID, e.g. scene.movie_night",
                },
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "ha_run_script",
        "category": "scenes_scripts",
        "description": "Run a Home Assistant script",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Script entity ID, e.g. script.welcome_home",
                },
            },
            "required": ["entity_id"],
        },
    },
    # --------------------------------------------------------------- query/generic
    {
        "name": "ha_get_state",
        "category": "query",
        "description": "Get the current state and attributes of a Home Assistant entity",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Entity ID to query, e.g. sensor.temperature",
                },
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "ha_list_areas",
        "category": "query",
        "description": "List all areas (rooms) configured in Home Assistant with their IDs and names",
        "parametersSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "ha_list_entities",
        "category": "query",
        "description": (
            "List Home Assistant entities. Each result includes the area/room the entity belongs to. "
            "Filter by domain and/or area_name to narrow results."
        ),
        "parametersSchema": {
            "type": "object",
            "properties": {
                "domain": {
                    "type": "string",
                    "description": "Optional domain filter, e.g. light, switch, climate, sensor",
                },
                "area_name": {
                    "type": "string",
                    "description": "Optional area name filter, e.g. Büro — returns only entities in that room",
                },
            },
        },
    },
    {
        "name": "ha_call_service",
        "category": "query",
        "description": "Call any Home Assistant service with full control over domain, service, and data",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "domain": {
                    "type": "string",
                    "description": "Service domain, e.g. light, switch, climate, script",
                },
                "service": {
                    "type": "string",
                    "description": "Service name, e.g. turn_on, set_temperature, press",
                },
                "entity_id": {
                    "type": "string",
                    "description": "Target entity ID (optional)",
                },
                "data": {
                    "type": "object",
                    "description": "Additional service data as key/value pairs (optional)",
                },
            },
            "required": ["domain", "service"],
        },
    },
    {
        "name": "ha_notify",
        "category": "query",
        "description": "Send a notification via Home Assistant",
        "parametersSchema": {
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "Notification message"},
                "title": {"type": "string", "description": "Notification title (optional)"},
                "target": {
                    "type": "string",
                    "description": "Notification service target, e.g. notify.mobile_app_phone (optional)",
                },
            },
            "required": ["message"],
        },
    },
]


def tools_for_categories(enabled_categories: list[str]) -> list[dict]:
    """Return tool definitions whose category is in enabled_categories."""
    cats = set(enabled_categories)
    return [t for t in TOOL_DEFINITIONS if t["category"] in cats]


HA_AGENT_PROMPT = """\
You are a Home Assistant controller. \
When the user asks you to control smart home devices, call the appropriate \
ha_* tool and confirm the result. Do not add roleplay, narration, or \
flavour text — just execute the command and report what happened.

Guidelines:
- Execute commands directly when the user asks. \
"Turn on the office lights" → call ha_turn_on with area_name="Office".
- Use area_name instead of individual entity_ids whenever acting on a room. \
This is faster and more reliable than listing entities first.
- If you don't know the exact area name, call ha_list_areas first, then act.
- If you need to find a specific entity_id, call ha_list_entities with \
domain and/or area_name to narrow the results — every result includes its area.
- Prefer specific tools (ha_set_brightness, ha_set_color) over ha_call_service \
unless no dedicated tool fits.
- Do not invent entity IDs. Query first if unsure.
- Report errors clearly so the user can correct them.
"""
