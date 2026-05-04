"""Marinara Engine Home Assistant Integration."""

from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .const import (
    CONF_ENABLED_CATEGORIES,
    CONF_HOST,
    CONF_PORT,
    CONF_PRIMARY_CHAT_ID,
    CONF_WEBHOOK_ID,
    DEFAULT_ENABLED_CATEGORIES,
    DOMAIN,
)
from .coordinator import MarinaraCoordinator
from .http import MarinaraToolManifestView
from .webhook import async_register_webhook, async_unregister_webhook

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR, Platform.SWITCH, Platform.SELECT, Platform.BUTTON]

SEND_MESSAGE_SCHEMA = vol.Schema(
    {
        vol.Optional("chat_id"): cv.string,
        vol.Required("message"): cv.string,
        vol.Optional("role", default="user"): vol.In(
            ["user", "assistant", "system", "narrator"]
        ),
        vol.Optional("trigger_generation", default=False): cv.boolean,
    }
)

TRIGGER_GENERATION_SCHEMA = vol.Schema(
    {
        vol.Optional("chat_id"): cv.string,
        vol.Optional("user_message"): cv.string,
    }
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = MarinaraCoordinator(
        hass, entry.data[CONF_HOST], entry.data[CONF_PORT]
    )
    await coordinator.async_verify_connection()
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    webhook_id: str = entry.data[CONF_WEBHOOK_ID]
    async_register_webhook(hass, webhook_id)
    hass.http.register_view(MarinaraToolManifestView(webhook_id, entry.entry_id))

    _async_register_services(hass, entry, coordinator)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Auto-sync HA tools into Marinara on every startup (idempotent — skips existing)
    enabled_categories = entry.options.get(CONF_ENABLED_CATEGORIES, DEFAULT_ENABLED_CATEGORIES)
    hass.async_create_task(
        _async_sync_tools(hass, coordinator, webhook_id, enabled_categories)
    )

    return True


async def _async_sync_tools(
    hass: HomeAssistant,
    coordinator: MarinaraCoordinator,
    webhook_id: str,
    enabled_categories: list[str],
) -> None:
    from homeassistant.helpers.network import NoURLAvailableError, get_url

    try:
        base_url = get_url(hass, allow_internal=True, prefer_external=False)
    except NoURLAvailableError:
        base_url = f"http://{hass.config.api.local_ip}:{hass.config.api.port}"

    webhook_url = f"{base_url}/api/webhook/{webhook_id}"
    try:
        created, updated = await coordinator.sync_tools(webhook_url, enabled_categories)
        _LOGGER.info(
            "Marinara Engine: tool sync complete — %d created, %d updated",
            created,
            updated,
        )
        agent_status = await coordinator.sync_agent(enabled_categories)
        if agent_status != "unchanged":
            _LOGGER.info("Marinara Engine: Home Assistant agent %s", agent_status)
    except Exception as err:
        _LOGGER.warning("Marinara Engine: could not auto-sync tools: %s", err)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    async_unregister_webhook(hass, entry.data[CONF_WEBHOOK_ID])
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload_ok


def _async_register_services(
    hass: HomeAssistant, entry: ConfigEntry, coordinator: MarinaraCoordinator
) -> None:
    if hass.services.has_service(DOMAIN, "send_message"):
        return

    async def _send_message(call: ServiceCall) -> None:
        chat_id = call.data.get("chat_id") or entry.options.get(CONF_PRIMARY_CHAT_ID)
        if not chat_id:
            _LOGGER.error(
                "marinara_engine.send_message: no chat_id provided and no primary chat set"
            )
            return
        await coordinator.send_message(
            chat_id, call.data["message"], call.data.get("role", "user")
        )
        if call.data.get("trigger_generation"):
            await coordinator.trigger_generation(chat_id)

    async def _trigger_generation(call: ServiceCall) -> None:
        chat_id = call.data.get("chat_id") or entry.options.get(CONF_PRIMARY_CHAT_ID)
        if not chat_id:
            _LOGGER.error(
                "marinara_engine.trigger_generation: no chat_id provided and no primary chat set"
            )
            return
        await coordinator.trigger_generation(chat_id, call.data.get("user_message"))

    hass.services.async_register(
        DOMAIN, "send_message", _send_message, schema=SEND_MESSAGE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        "trigger_generation",
        _trigger_generation,
        schema=TRIGGER_GENERATION_SCHEMA,
    )
