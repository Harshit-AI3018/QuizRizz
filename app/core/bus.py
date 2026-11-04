"""
Broadcast bus interface for CampusQuiz.

Provides:
- BroadcastBus (ABC): clean interface for event publishing and subscription.
- InMemoryBroadcastBus: default in-process bus for single-instance & unit testing.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
import asyncio
import json
import logging
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)


class BroadcastBus(ABC):
    @abstractmethod
    async def start(self) -> None:
        """Start listening or initialize bus background tasks."""

    @abstractmethod
    async def stop(self) -> None:
        """Stop listening and cleanly release resources."""

    @abstractmethod
    async def publish(self, channel: str, message: dict[str, Any]) -> None:
        """Publish a message dictionary to a named channel."""

    @abstractmethod
    def subscribe(
        self,
        channel: str,
        callback: Callable[[dict[str, Any]], Coroutine[Any, Any, None]],
    ) -> None:
        """Register a callback for messages received on channel."""


class InMemoryBroadcastBus(BroadcastBus):
    """
    Zero-dependency in-process broadcast bus.
    Default for development, unit testing, and single-instance deployments.
    """

    def __init__(self) -> None:
        self._subscribers: dict[str, list[Callable[[dict[str, Any]], Coroutine[Any, Any, None]]]] = {}
        self._is_running = False

    async def start(self) -> None:
        self._is_running = True

    async def stop(self) -> None:
        self._is_running = False
        self._subscribers.clear()

    async def publish(self, channel: str, message: dict[str, Any]) -> None:
        if not self._is_running:
            return
        callbacks = list(self._subscribers.get(channel, []))
        for cb in callbacks:
            try:
                await cb(message)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Error in bus subscriber callback: %s", exc)

    def subscribe(
        self,
        channel: str,
        callback: Callable[[dict[str, Any]], Coroutine[Any, Any, None]],
    ) -> None:
        if channel not in self._subscribers:
            self._subscribers[channel] = []
        self._subscribers[channel].append(callback)
