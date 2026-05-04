"""DataUpdateCoordinator for Marinara Engine."""

from __future__ import annotations

import json
import logging
from datetime import timedelta

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN, SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)


class MarinaraCoordinator(DataUpdateCoordinator[dict]):
    """Polls Marinara Engine for chats and agents."""

    def __init__(self, hass: HomeAssistant, host: str, port: int) -> None:
        self.base_url = f"http://{host}:{port}"
        self._session = async_get_clientsession(hass)
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=SCAN_INTERVAL),
        )

    async def _async_update_data(self) -> dict:
        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with self._session.get(
                f"{self.base_url}/api/chats", timeout=timeout
            ) as resp:
                resp.raise_for_status()
                chats = await resp.json()

            async with self._session.get(
                f"{self.base_url}/api/agents", timeout=timeout
            ) as resp:
                resp.raise_for_status()
                agents = await resp.json()

            return {"chats": chats, "agents": agents}
        except aiohttp.ClientConnectionError as err:
            raise UpdateFailed(f"Cannot reach Marinara Engine: {err}") from err
        except aiohttp.ClientResponseError as err:
            raise UpdateFailed(f"Marinara Engine returned error {err.status}") from err
        except Exception as err:
            raise UpdateFailed(f"Unexpected error: {err}") from err

    async def async_verify_connection(self) -> None:
        """Raise ConfigEntryNotReady if the server is unreachable."""
        try:
            async with self._session.get(
                f"{self.base_url}/api/chats",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                resp.raise_for_status()
        except Exception as err:
            raise ConfigEntryNotReady(
                f"Cannot connect to Marinara Engine at {self.base_url}: {err}"
            ) from err

    async def send_message(self, chat_id: str, content: str, role: str = "user") -> None:
        """POST a message to a chat."""
        async with self._session.post(
            f"{self.base_url}/api/chats/{chat_id}/messages",
            json={"chatId": chat_id, "role": role, "content": content, "characterId": None},
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()

    async def trigger_generation(
        self, chat_id: str, user_message: str | None = None
    ) -> None:
        """Start AI generation for a chat (fire-and-forget, non-streaming)."""
        async with self._session.post(
            f"{self.base_url}/api/generate",
            json={
                "chatId": chat_id,
                "userMessage": user_message,
                "streaming": False,
                "userStatus": "active",
            },
            timeout=aiohttp.ClientTimeout(total=120),
        ) as resp:
            resp.raise_for_status()

    async def abort_generation(self) -> None:
        """Cancel any in-flight generation."""
        async with self._session.post(
            f"{self.base_url}/api/generate/abort",
            timeout=aiohttp.ClientTimeout(total=5),
        ) as resp:
            resp.raise_for_status()

    async def set_agent_enabled(self, agent_id: str, enabled: bool) -> None:
        """Toggle global enabled state for an agent."""
        async with self._session.patch(
            f"{self.base_url}/api/agents/{agent_id}",
            json={"enabled": enabled},
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()

    async def sync_agent(self, enabled_categories: list[str]) -> str:
        """Create or update the Home Assistant agent in Marinara.

        Returns "created", "updated", or "unchanged".
        """
        from .const import HA_AGENT_PROMPT, tools_for_categories

        tool_names = [t["name"] for t in tools_for_categories(enabled_categories)]

        timeout = aiohttp.ClientTimeout(total=10)

        async with self._session.get(
            f"{self.base_url}/api/agents", timeout=timeout
        ) as resp:
            resp.raise_for_status()
            agents = await resp.json()
        if not isinstance(agents, list):
            agents = []

        existing = next(
            (
                agent
                for agent in agents
                if isinstance(agent, dict) and agent.get("type") == "home_assistant"
            ),
            None,
        )

        if existing is not None:
            settings = existing.get("settings") or {}
            if isinstance(settings, str):
                try:
                    settings = json.loads(settings)
                except (TypeError, ValueError) as err:
                    _LOGGER.warning(
                        "Invalid JSON in Home Assistant agent settings for id=%s: %s",
                        existing.get("id"),
                        err,
                    )
                    settings = {}
            if not isinstance(settings, dict):
                settings = {}
            current_tools = settings.get("enabledTools") or []
            if set(current_tools) == set(tool_names):
                return "unchanged"
            async with self._session.patch(
                f"{self.base_url}/api/agents/{existing['id']}",
                json={"settings": {"enabledTools": tool_names}},
                timeout=timeout,
            ) as resp:
                resp.raise_for_status()
            return "updated"

        payload = {
            "type": "home_assistant",
            "name": "Home Assistant",
            "description": (
                "Controls Home Assistant smart home devices — lights, climate, "
                "covers, locks, media players, scenes, and scripts."
            ),
            "phase": "parallel",
            "enabled": True,
            "connectionId": None,
            "promptTemplate": HA_AGENT_PROMPT,
            "settings": {"enabledTools": tool_names},
        }
        async with self._session.post(
            f"{self.base_url}/api/agents", json=payload, timeout=timeout
        ) as resp:
            resp.raise_for_status()

        return "created"

    async def sync_tools(
        self, webhook_url: str, enabled_categories: list[str]
    ) -> tuple[int, int]:
        """Upsert HA tool definitions into Marinara for the given categories.

        Creates missing tools and updates existing ones so schema changes propagate.
        Returns (created, updated) counts.
        """
        from .const import TOOL_DEFINITIONS, tools_for_categories

        tools = tools_for_categories(enabled_categories)
        selected_names = {tool["name"] for tool in tools}
        managed_names = {tool["name"] for tool in TOOL_DEFINITIONS}

        timeout = aiohttp.ClientTimeout(total=10)

        async with self._session.get(
            f"{self.base_url}/api/custom-tools", timeout=timeout
        ) as resp:
            resp.raise_for_status()
            existing = await resp.json()
        if not isinstance(existing, list):
            existing = []

        existing_by_name = {
            t["name"]: t
            for t in existing
            if isinstance(t, dict) and isinstance(t.get("name"), str)
        }

        created = 0
        updated = 0
        for tool in tools:
            payload = {
                "name": tool["name"],
                "description": tool["description"],
                "parametersSchema": tool["parametersSchema"],
                "executionType": "webhook",
                "webhookUrl": webhook_url,
                "enabled": True,
            }
            if tool["name"] in existing_by_name:
                tool_id = existing_by_name[tool["name"]]["id"]
                async with self._session.patch(
                    f"{self.base_url}/api/custom-tools/{tool_id}",
                    json=payload,
                    timeout=timeout,
                ) as resp:
                    resp.raise_for_status()
                updated += 1
            else:
                async with self._session.post(
                    f"{self.base_url}/api/custom-tools",
                    json=payload,
                    timeout=timeout,
                ) as resp:
                    resp.raise_for_status()
                created += 1

        for name, existing_tool in existing_by_name.items():
            if (
                name in managed_names
                and name not in selected_names
                and existing_tool.get("webhookUrl") == webhook_url
                and existing_tool.get("enabled") is not False
            ):
                async with self._session.patch(
                    f"{self.base_url}/api/custom-tools/{existing_tool['id']}",
                    json={"enabled": False},
                    timeout=timeout,
                ) as resp:
                    resp.raise_for_status()
                updated += 1

        return created, updated
