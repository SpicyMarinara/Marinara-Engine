"""Webhook handler: receives tool calls from Marinara Engine and executes HA actions."""

from __future__ import annotations

import logging
from typing import Any

from aiohttp import web

from homeassistant.components.webhook import (
    async_register,
    async_unregister,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar_helper
from homeassistant.helpers import entity_registry as er_helper

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


def async_register_webhook(hass: HomeAssistant, webhook_id: str) -> None:
    async_register(
        hass,
        DOMAIN,
        "Marinara Engine",
        webhook_id,
        _handle_webhook,
        allowed_methods=["POST"],
    )


def async_unregister_webhook(hass: HomeAssistant, webhook_id: str) -> None:
    async_unregister(hass, webhook_id)


async def _handle_webhook(
    hass: HomeAssistant, webhook_id: str, request: web.Request
) -> web.Response:
    """Dispatch an incoming tool call to the appropriate HA action."""
    try:
        body = await request.json()
    except Exception:
        return web.Response(status=400, text="Invalid JSON body")

    tool: str = body.get("tool", "")
    args: dict[str, Any] = body.get("arguments", {})

    _LOGGER.debug("Marinara webhook: tool=%s args=%s", tool, args)

    handler = _DISPATCH.get(tool)
    if handler is None:
        _LOGGER.warning("Marinara webhook: unknown tool '%s'", tool)
        return web.json_response({"error": f"Unknown tool: {tool}"}, status=400)

    try:
        result = await handler(hass, args)
    except Exception as err:
        _LOGGER.error("Marinara webhook: tool '%s' failed: %s", tool, err)
        return web.json_response({"error": str(err)}, status=500)

    return web.json_response(result)


# ---------------------------------------------------------------------------
# Area helpers
# ---------------------------------------------------------------------------

def _get_area(hass: HomeAssistant, area_name: str):
    ar = ar_helper.async_get(hass)
    area = ar.async_get_area_by_name(area_name)
    if area is None:
        raise ValueError(
            f"Area '{area_name}' not found. Call ha_list_areas to see available areas."
        )
    return area


def _resolve_entity_and_target(
    hass: HomeAssistant, args: dict
) -> tuple[str | None, dict | None]:
    """Return (entity_id, target) — exactly one will be non-None."""
    entity_id = args.get("entity_id")
    area_name = args.get("area_name")
    if entity_id:
        return entity_id, None
    if area_name:
        area = _get_area(hass, area_name)
        return None, {"area_id": area.id}
    raise ValueError("Provide entity_id or area_name")


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

async def _turn_on(hass: HomeAssistant, args: dict) -> dict:
    entity_id, target = _resolve_entity_and_target(hass, args)
    if entity_id:
        await hass.services.async_call(
            "homeassistant", "turn_on", {"entity_id": entity_id}, blocking=True
        )
        return {"result": f"Turned on {entity_id}"}
    domain = args.get("domain", "light")
    await hass.services.async_call(domain, "turn_on", {}, target=target, blocking=True)
    return {"result": f"Turned on all {domain} in area"}


async def _turn_off(hass: HomeAssistant, args: dict) -> dict:
    entity_id, target = _resolve_entity_and_target(hass, args)
    if entity_id:
        await hass.services.async_call(
            "homeassistant", "turn_off", {"entity_id": entity_id}, blocking=True
        )
        return {"result": f"Turned off {entity_id}"}
    domain = args.get("domain", "light")
    await hass.services.async_call(domain, "turn_off", {}, target=target, blocking=True)
    return {"result": f"Turned off all {domain} in area"}


async def _toggle(hass: HomeAssistant, args: dict) -> dict:
    entity_id, target = _resolve_entity_and_target(hass, args)
    if entity_id:
        await hass.services.async_call(
            "homeassistant", "toggle", {"entity_id": entity_id}, blocking=True
        )
        return {"result": f"Toggled {entity_id}"}
    domain = args.get("domain", "light")
    await hass.services.async_call(domain, "toggle", {}, target=target, blocking=True)
    return {"result": f"Toggled all {domain} in area"}


async def _get_state(hass: HomeAssistant, args: dict) -> dict:
    entity_id = _require(args, "entity_id")
    state = hass.states.get(entity_id)
    if state is None:
        return {"error": f"Entity '{entity_id}' not found"}
    return {
        "entity_id": entity_id,
        "state": state.state,
        "attributes": dict(state.attributes),
        "last_updated": state.last_updated.isoformat(),
    }


async def _list_areas(hass: HomeAssistant, args: dict) -> dict:
    ar = ar_helper.async_get(hass)
    return {
        "areas": [
            {"id": area.id, "name": area.name}
            for area in ar.areas.values()
        ]
    }


async def _list_entities(hass: HomeAssistant, args: dict) -> dict:
    domain_filter: str | None = args.get("domain")
    area_name: str | None = args.get("area_name")

    er = er_helper.async_get(hass)
    ar = ar_helper.async_get(hass)

    area_names: dict[str, str] = {a.id: a.name for a in ar.areas.values()}
    entity_areas: dict[str, str | None] = {
        e.entity_id: e.area_id for e in er.entities.values()
    }

    area_entity_ids: set[str] | None = None
    if area_name:
        area = _get_area(hass, area_name)
        area_entity_ids = {
            eid for eid, aid in entity_areas.items() if aid == area.id
        }

    entities = []
    for s in hass.states.async_all(domain_filter):
        if area_entity_ids is not None and s.entity_id not in area_entity_ids:
            continue
        area_id = entity_areas.get(s.entity_id)
        entities.append({
            "entity_id": s.entity_id,
            "state": s.state,
            "friendly_name": s.attributes.get("friendly_name"),
            "area": area_names.get(area_id) if area_id else None,
        })

    return {"entities": entities}


async def _call_service(hass: HomeAssistant, args: dict) -> dict:
    domain = _require(args, "domain")
    service = _require(args, "service")
    data: dict = dict(args.get("data") or {})
    entity_id = args.get("entity_id")
    if entity_id:
        data["entity_id"] = entity_id
    await hass.services.async_call(domain, service, data, blocking=True)
    return {"result": f"Called {domain}.{service}"}


async def _set_brightness(hass: HomeAssistant, args: dict) -> dict:
    entity_id, target = _resolve_entity_and_target(hass, args)
    brightness_pct = float(_require(args, "brightness_pct"))
    data: dict = {"brightness_pct": brightness_pct}
    if entity_id:
        data["entity_id"] = entity_id
    await hass.services.async_call("light", "turn_on", data, target=target, blocking=True)
    return {"result": f"Set brightness to {brightness_pct}%"}


async def _set_color(hass: HomeAssistant, args: dict) -> dict:
    entity_id, target = _resolve_entity_and_target(hass, args)
    r = int(_require(args, "r"))
    g = int(_require(args, "g"))
    b = int(_require(args, "b"))
    data: dict = {"rgb_color": [r, g, b]}
    if entity_id:
        data["entity_id"] = entity_id
    await hass.services.async_call("light", "turn_on", data, target=target, blocking=True)
    return {"result": f"Set color to rgb({r},{g},{b})"}


async def _set_color_temp(hass: HomeAssistant, args: dict) -> dict:
    entity_id, target = _resolve_entity_and_target(hass, args)
    kelvin = int(_require(args, "kelvin"))
    data: dict = {"kelvin": kelvin}
    if entity_id:
        data["entity_id"] = entity_id
    await hass.services.async_call("light", "turn_on", data, target=target, blocking=True)
    return {"result": f"Set color temperature to {kelvin}K"}


async def _set_temperature(hass: HomeAssistant, args: dict) -> dict:
    entity_id, target = _resolve_entity_and_target(hass, args)
    temperature = float(_require(args, "temperature"))
    data: dict = {"temperature": temperature}
    if entity_id:
        data["entity_id"] = entity_id
    await hass.services.async_call(
        "climate", "set_temperature", data, target=target, blocking=True
    )
    return {"result": f"Set temperature to {temperature}"}


async def _set_hvac_mode(hass: HomeAssistant, args: dict) -> dict:
    entity_id, target = _resolve_entity_and_target(hass, args)
    hvac_mode = _require(args, "hvac_mode")
    data: dict = {"hvac_mode": hvac_mode}
    if entity_id:
        data["entity_id"] = entity_id
    await hass.services.async_call(
        "climate", "set_hvac_mode", data, target=target, blocking=True
    )
    return {"result": f"Set HVAC mode to {hvac_mode}"}


async def _activate_scene(hass: HomeAssistant, args: dict) -> dict:
    entity_id = _require(args, "entity_id")
    await hass.services.async_call(
        "scene", "turn_on", {"entity_id": entity_id}, blocking=True
    )
    return {"result": f"Activated scene {entity_id}"}


async def _run_script(hass: HomeAssistant, args: dict) -> dict:
    entity_id = _require(args, "entity_id")
    await hass.services.async_call(
        "script", "turn_on", {"entity_id": entity_id}, blocking=True
    )
    return {"result": f"Ran script {entity_id}"}


async def _media_play(hass: HomeAssistant, args: dict) -> dict:
    entity_id = _require(args, "entity_id")
    data: dict = {"entity_id": entity_id}
    if args.get("media_content_id"):
        data["media_content_id"] = args["media_content_id"]
        data["media_content_type"] = args.get("media_content_type", "music")
        await hass.services.async_call(
            "media_player", "play_media", data, blocking=True
        )
    else:
        await hass.services.async_call(
            "media_player", "media_play", {"entity_id": entity_id}, blocking=True
        )
    return {"result": f"Playing on {entity_id}"}


async def _media_pause(hass: HomeAssistant, args: dict) -> dict:
    entity_id = _require(args, "entity_id")
    await hass.services.async_call(
        "media_player", "media_pause", {"entity_id": entity_id}, blocking=True
    )
    return {"result": f"Paused {entity_id}"}


async def _set_volume(hass: HomeAssistant, args: dict) -> dict:
    entity_id = _require(args, "entity_id")
    volume_level = float(_require(args, "volume_level"))
    await hass.services.async_call(
        "media_player",
        "volume_set",
        {"entity_id": entity_id, "volume_level": volume_level},
        blocking=True,
    )
    return {"result": f"Set volume to {volume_level}"}


async def _lock(hass: HomeAssistant, args: dict) -> dict:
    entity_id = _require(args, "entity_id")
    await hass.services.async_call(
        "lock", "lock", {"entity_id": entity_id}, blocking=True
    )
    return {"result": f"Locked {entity_id}"}


async def _unlock(hass: HomeAssistant, args: dict) -> dict:
    entity_id = _require(args, "entity_id")
    data: dict = {"entity_id": entity_id}
    if args.get("code"):
        data["code"] = args["code"]
    await hass.services.async_call("lock", "unlock", data, blocking=True)
    return {"result": f"Unlocked {entity_id}"}


async def _open_cover(hass: HomeAssistant, args: dict) -> dict:
    entity_id, target = _resolve_entity_and_target(hass, args)
    data: dict = {}
    if entity_id:
        data["entity_id"] = entity_id
    await hass.services.async_call("cover", "open_cover", data, target=target, blocking=True)
    return {"result": "Opened cover(s)"}


async def _close_cover(hass: HomeAssistant, args: dict) -> dict:
    entity_id, target = _resolve_entity_and_target(hass, args)
    data: dict = {}
    if entity_id:
        data["entity_id"] = entity_id
    await hass.services.async_call("cover", "close_cover", data, target=target, blocking=True)
    return {"result": "Closed cover(s)"}


async def _set_cover_position(hass: HomeAssistant, args: dict) -> dict:
    entity_id, target = _resolve_entity_and_target(hass, args)
    position = int(_require(args, "position"))
    data: dict = {"position": position}
    if entity_id:
        data["entity_id"] = entity_id
    await hass.services.async_call(
        "cover", "set_cover_position", data, target=target, blocking=True
    )
    return {"result": f"Set cover position to {position}%"}


async def _notify(hass: HomeAssistant, args: dict) -> dict:
    message = _require(args, "message")
    target = args.get("target", "notify.notify")
    parts = target.split(".", 1)
    domain = parts[0] if len(parts) == 2 else "notify"
    service = parts[1] if len(parts) == 2 else "notify"
    data: dict = {"message": message}
    if args.get("title"):
        data["title"] = args["title"]
    await hass.services.async_call(domain, service, data, blocking=True)
    return {"result": "Notification sent"}


_DISPATCH = {
    "ha_turn_on": _turn_on,
    "ha_turn_off": _turn_off,
    "ha_toggle": _toggle,
    "ha_get_state": _get_state,
    "ha_list_areas": _list_areas,
    "ha_list_entities": _list_entities,
    "ha_call_service": _call_service,
    "ha_set_brightness": _set_brightness,
    "ha_set_color": _set_color,
    "ha_set_color_temp": _set_color_temp,
    "ha_set_temperature": _set_temperature,
    "ha_set_hvac_mode": _set_hvac_mode,
    "ha_activate_scene": _activate_scene,
    "ha_run_script": _run_script,
    "ha_media_play": _media_play,
    "ha_media_pause": _media_pause,
    "ha_set_volume": _set_volume,
    "ha_lock": _lock,
    "ha_unlock": _unlock,
    "ha_open_cover": _open_cover,
    "ha_close_cover": _close_cover,
    "ha_set_cover_position": _set_cover_position,
    "ha_notify": _notify,
}


def _require(args: dict, key: str) -> Any:
    value = args.get(key)
    if value is None:
        raise ValueError(f"Missing required argument: {key}")
    return value
