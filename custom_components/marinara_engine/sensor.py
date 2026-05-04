"""Sensor platform for Marinara Engine."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorStateClass
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
    async_add_entities(
        [
            MarinaraChatCountSensor(coordinator, entry),
            MarinaraActiveAgentCountSensor(coordinator, entry),
        ]
    )


class _MarinaraEntity(CoordinatorEntity[MarinaraCoordinator]):
    def __init__(self, coordinator: MarinaraCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._entry = entry

    @property
    def device_info(self) -> dict:
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": "Marinara Engine",
            "manufacturer": "Marinara Engine",
            "model": "Local AI Engine",
            "configuration_url": self.coordinator.base_url,
        }


class MarinaraChatCountSensor(_MarinaraEntity, SensorEntity):
    """Total number of chats in Marinara Engine."""

    _attr_icon = "mdi:chat-outline"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "chats"

    def __init__(self, coordinator: MarinaraCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry)
        self._attr_unique_id = f"{entry.entry_id}_chat_count"
        self._attr_name = "Marinara Chat Count"

    @property
    def native_value(self) -> int:
        return len(self.coordinator.data.get("chats", []))

    @property
    def extra_state_attributes(self) -> dict:
        chats = self.coordinator.data.get("chats", [])
        by_mode: dict[str, int] = {}
        for c in chats:
            mode = c.get("mode", "unknown")
            by_mode[mode] = by_mode.get(mode, 0) + 1
        return {"by_mode": by_mode}


class MarinaraActiveAgentCountSensor(_MarinaraEntity, SensorEntity):
    """Number of globally enabled agents."""

    _attr_icon = "mdi:robot-outline"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "agents"

    def __init__(self, coordinator: MarinaraCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry)
        self._attr_unique_id = f"{entry.entry_id}_active_agent_count"
        self._attr_name = "Marinara Active Agent Count"

    @property
    def native_value(self) -> int:
        agents = self.coordinator.data.get("agents", [])
        return sum(1 for a in agents if a.get("enabled") == "true")

    @property
    def extra_state_attributes(self) -> dict:
        agents = self.coordinator.data.get("agents", [])
        return {
            "total_agents": len(agents),
            "enabled_agents": [
                a.get("name") for a in agents if a.get("enabled") == "true"
            ],
        }
