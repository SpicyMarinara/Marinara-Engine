"""Button platform for Marinara Engine."""

from __future__ import annotations

import logging

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.network import NoURLAvailableError, get_url
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_ENABLED_CATEGORIES, CONF_WEBHOOK_ID, DEFAULT_ENABLED_CATEGORIES, DOMAIN
from .coordinator import MarinaraCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: MarinaraCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([
        MarinaraAbortButton(coordinator, entry),
        MarinaraSyncToolsButton(coordinator, entry),
    ])


class MarinaraAbortButton(CoordinatorEntity[MarinaraCoordinator], ButtonEntity):
    """Cancel any in-flight AI generation."""

    _attr_icon = "mdi:stop-circle-outline"

    def __init__(self, coordinator: MarinaraCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_abort_generation"
        self._attr_name = "Marinara Abort Generation"

    @property
    def device_info(self) -> dict:
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": "Marinara Engine",
            "manufacturer": "Marinara Engine",
            "model": "Local AI Engine",
        }

    async def async_press(self) -> None:
        await self.coordinator.abort_generation()


class MarinaraSyncToolsButton(CoordinatorEntity[MarinaraCoordinator], ButtonEntity):
    """Push all 21 HA tool definitions into Marinara's Custom Tools."""

    _attr_icon = "mdi:cloud-sync-outline"

    def __init__(self, coordinator: MarinaraCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_sync_tools"
        self._attr_name = "Marinara Sync HA Tools"

    @property
    def device_info(self) -> dict:
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": "Marinara Engine",
            "manufacturer": "Marinara Engine",
            "model": "Local AI Engine",
        }

    async def async_press(self) -> None:
        webhook_id: str = self._entry.data[CONF_WEBHOOK_ID]
        try:
            base_url = get_url(self.hass, allow_internal=True, prefer_external=False)
        except NoURLAvailableError:
            api = getattr(self.hass.config, "api", None)
            if api is None or not api.local_ip or not api.port:
                _LOGGER.error("Cannot determine Home Assistant URL for tool sync")
                return
            base_url = f"http://{api.local_ip}:{api.port}"
        webhook_url = f"{base_url}/api/webhook/{webhook_id}"
        enabled_categories = self._entry.options.get(
            CONF_ENABLED_CATEGORIES, DEFAULT_ENABLED_CATEGORIES
        )
        try:
            created, updated = await self.coordinator.sync_tools(
                webhook_url, enabled_categories
            )
            _LOGGER.info(
                "Marinara tool sync: %d created, %d updated", created, updated
            )
            agent_status = await self.coordinator.sync_agent(enabled_categories)
            if agent_status != "unchanged":
                _LOGGER.info("Marinara tool sync: Home Assistant agent %s", agent_status)
        except Exception:
            _LOGGER.exception("Marinara tool sync failed")
