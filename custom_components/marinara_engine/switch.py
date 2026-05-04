"""Switch platform for Marinara Engine — one switch per agent."""

from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import MarinaraCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: MarinaraCoordinator = hass.data[DOMAIN][entry.entry_id]
    agents = coordinator.data.get("agents", [])
    async_add_entities(
        [MarinaraAgentSwitch(coordinator, entry, agent) for agent in agents],
        update_before_add=True,
    )


class MarinaraAgentSwitch(CoordinatorEntity[MarinaraCoordinator], SwitchEntity):
    """Toggle the global enabled state of a Marinara Engine agent."""

    _attr_icon = "mdi:robot"

    def __init__(
        self,
        coordinator: MarinaraCoordinator,
        entry: ConfigEntry,
        agent: dict,
    ) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._agent_id: str = agent["id"]
        self._attr_unique_id = f"{entry.entry_id}_agent_{agent['id']}"
        self._attr_name = f"Marinara Agent: {agent.get('name', agent['id'])}"

    @property
    def device_info(self) -> dict:
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": "Marinara Engine",
            "manufacturer": "Marinara Engine",
            "model": "Local AI Engine",
        }

    @property
    def is_on(self) -> bool:
        for agent in self.coordinator.data.get("agents", []):
            if agent["id"] == self._agent_id:
                return agent.get("enabled") == "true"
        return False

    @property
    def extra_state_attributes(self) -> dict:
        for agent in self.coordinator.data.get("agents", []):
            if agent["id"] == self._agent_id:
                return {
                    "agent_id": self._agent_id,
                    "type": agent.get("type"),
                    "phase": agent.get("phase"),
                    "description": agent.get("description"),
                }
        return {}

    async def async_turn_on(self, **kwargs) -> None:
        await self.coordinator.set_agent_enabled(self._agent_id, True)
        await self.coordinator.async_request_refresh()

    async def async_turn_off(self, **kwargs) -> None:
        await self.coordinator.set_agent_enabled(self._agent_id, False)
        await self.coordinator.async_request_refresh()
