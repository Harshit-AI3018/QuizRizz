"""
SessionRoomHub — Connection and presence management for live quiz sessions.

Refinements:
- Tracks multiple open sockets per student (tabs, reconnects).
- Marks student disconnected ONLY when their last valid socket closes.
- Presence semantics: cleanly separates is_connected, attempt_status, and last_seen_at.
- Zero mutation of attempt/submission state upon WebSocket disconnect.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
from typing import Any
from uuid import UUID

from starlette.websockets import WebSocket, WebSocketState

from app.core.bus import BroadcastBus, InMemoryBroadcastBus

logger = logging.getLogger(__name__)


@dataclass
class StudentPresenceRecord:
    student_user_id: UUID
    student_name: str
    roll_number: str | None
    is_connected: bool
    last_seen_at: datetime
    attempt_status: str = "NOT_STARTED"


class SessionRoomHub:
    """
    Central connection hub for live quiz sessions.
    Manages WebSocket lifecycles for both faculty monitors and student clients.
    """

    def __init__(self, bus: BroadcastBus | None = None) -> None:
        self.bus: BroadcastBus = bus or InMemoryBroadcastBus()
        # session_id -> set of faculty WebSockets
        self._faculty_sockets: dict[UUID, set[WebSocket]] = {}
        # session_id -> student_user_id -> set of active student WebSockets
        self._student_sockets: dict[UUID, dict[UUID, set[WebSocket]]] = {}
        # session_id -> student_user_id -> StudentPresenceRecord
        self._presence: dict[UUID, dict[UUID, StudentPresenceRecord]] = {}
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        await self.bus.start()
        # Subscribe to bus events for multi-instance replication
        self.bus.subscribe("session_events", self._handle_bus_event)

    async def stop(self) -> None:
        await self.bus.stop()
        async with self._lock:
            self._faculty_sockets.clear()
            self._student_sockets.clear()
            self._presence.clear()

    async def _handle_bus_event(self, message: dict[str, Any]) -> None:
        """Dispatches an event received from the broadcast bus to local sockets."""
        session_id_str = message.get("session_id")
        target = message.get("target", "session")  # "faculty", "students", "session"
        event_payload = message.get("payload")

        if not session_id_str or not event_payload:
            return

        try:
            session_id = UUID(session_id_str)
        except (ValueError, TypeError):
            return

        if target == "faculty":
            await self._send_to_local_faculty(session_id, event_payload)
        elif target == "students":
            await self._send_to_local_students(session_id, event_payload)
        else:
            await self._send_to_local_faculty(session_id, event_payload)
            await self._send_to_local_students(session_id, event_payload)

    # -------------------------------------------------------------------------
    # Faculty Connection Management
    # -------------------------------------------------------------------------

    async def connect_faculty(self, session_id: UUID, socket: WebSocket) -> None:
        async with self._lock:
            if session_id not in self._faculty_sockets:
                self._faculty_sockets[session_id] = set()
            self._faculty_sockets[session_id].add(socket)

    async def disconnect_faculty(self, session_id: UUID, socket: WebSocket) -> None:
        async with self._lock:
            if session_id in self._faculty_sockets:
                self._faculty_sockets[session_id].discard(socket)
                if not self._faculty_sockets[session_id]:
                    del self._faculty_sockets[session_id]

    # -------------------------------------------------------------------------
    # Student Connection Management (Supports multiple sockets per student)
    # -------------------------------------------------------------------------

    async def connect_student(
        self,
        session_id: UUID,
        student_user_id: UUID,
        student_name: str,
        roll_number: str | None,
        socket: WebSocket,
    ) -> bool:
        """
        Registers a student WebSocket.
        Returns True if this is the student's FIRST connection (transitions to online).
        Returns False if the student already had another active connection.
        """
        async with self._lock:
            if session_id not in self._student_sockets:
                self._student_sockets[session_id] = {}
            if session_id not in self._presence:
                self._presence[session_id] = {}

            student_socks = self._student_sockets[session_id].get(student_user_id)
            was_connected = student_socks is not None and len(student_socks) > 0

            if student_socks is None:
                student_socks = set()
                self._student_sockets[session_id][student_user_id] = student_socks

            student_socks.add(socket)

            now = datetime.now(timezone.utc)
            if student_user_id not in self._presence[session_id]:
                self._presence[session_id][student_user_id] = StudentPresenceRecord(
                    student_user_id=student_user_id,
                    student_name=student_name,
                    roll_number=roll_number,
                    is_connected=True,
                    last_seen_at=now,
                )
            else:
                rec = self._presence[session_id][student_user_id]
                rec.is_connected = True
                rec.last_seen_at = now

            return not was_connected

    async def disconnect_student(
        self,
        session_id: UUID,
        student_user_id: UUID,
        socket: WebSocket,
    ) -> bool:
        """
        Removes a student WebSocket.
        Returns True ONLY if this was the student's LAST connection (transitions to offline).
        Returns False if the student still has other active connections open.
        """
        async with self._lock:
            student_socks = self._student_sockets.get(session_id, {}).get(student_user_id)
            if student_socks is None:
                return False

            student_socks.discard(socket)
            if len(student_socks) == 0:
                # Last socket disconnected!
                del self._student_sockets[session_id][student_user_id]
                if not self._student_sockets[session_id]:
                    del self._student_sockets[session_id]

                if session_id in self._presence and student_user_id in self._presence[session_id]:
                    rec = self._presence[session_id][student_user_id]
                    rec.is_connected = False
                    rec.last_seen_at = datetime.now(timezone.utc)

                return True

            return False

    async def touch_student(self, session_id: UUID, student_user_id: UUID) -> None:
        """Updates last_seen_at timestamp on heartbeat/activity."""
        async with self._lock:
            if session_id in self._presence and student_user_id in self._presence[session_id]:
                self._presence[session_id][student_user_id].last_seen_at = datetime.now(timezone.utc)

    # -------------------------------------------------------------------------
    # Presence Queries
    # -------------------------------------------------------------------------

    async def get_connected_students_count(self, session_id: UUID) -> int:
        async with self._lock:
            sess_students = self._student_sockets.get(session_id, {})
            return sum(1 for sockets in sess_students.values() if len(sockets) > 0)

    async def get_presence_record(
        self,
        session_id: UUID,
        student_user_id: UUID,
    ) -> StudentPresenceRecord | None:
        async with self._lock:
            return self._presence.get(session_id, {}).get(student_user_id)

    async def get_all_presence(self, session_id: UUID) -> dict[UUID, StudentPresenceRecord]:
        async with self._lock:
            return dict(self._presence.get(session_id, {}))

    # -------------------------------------------------------------------------
    # Broadcasting & Message Delivery
    # -------------------------------------------------------------------------

    async def broadcast_to_faculty(self, session_id: UUID, event_payload: dict[str, Any]) -> None:
        """Publishes an event to faculty monitors via the bus."""
        # 1. Deliver to local faculty sockets
        await self._send_to_local_faculty(session_id, event_payload)
        # 2. Publish to bus for any remote instances
        await self.bus.publish(
            "session_events",
            {
                "session_id": str(session_id),
                "target": "faculty",
                "payload": event_payload,
            },
        )

    async def broadcast_to_students(self, session_id: UUID, event_payload: dict[str, Any]) -> None:
        """Publishes an event to student clients via the bus."""
        await self._send_to_local_students(session_id, event_payload)
        await self.bus.publish(
            "session_events",
            {
                "session_id": str(session_id),
                "target": "students",
                "payload": event_payload,
            },
        )

    async def broadcast_to_session(self, session_id: UUID, event_payload: dict[str, Any]) -> None:
        """Publishes an event to both faculty and students."""
        await self._send_to_local_faculty(session_id, event_payload)
        await self._send_to_local_students(session_id, event_payload)
        await self.bus.publish(
            "session_events",
            {
                "session_id": str(session_id),
                "target": "session",
                "payload": event_payload,
            },
        )

    async def send_to_student(
        self,
        session_id: UUID,
        student_user_id: UUID,
        event_payload: dict[str, Any],
    ) -> None:
        """Delivers directly to all open sockets of a specific student."""
        async with self._lock:
            sockets = set(self._student_sockets.get(session_id, {}).get(student_user_id, set()))

        payload_str = json.dumps(event_payload, default=str)
        dead_sockets: list[WebSocket] = []
        for ws in sockets:
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_text(payload_str)
            except Exception:
                dead_sockets.append(ws)

        if dead_sockets:
            for ws in dead_sockets:
                await self.disconnect_student(session_id, student_user_id, ws)

    async def _send_to_local_faculty(self, session_id: UUID, event_payload: dict[str, Any]) -> None:
        async with self._lock:
            sockets = set(self._faculty_sockets.get(session_id, set()))

        if not sockets:
            return

        payload_str = json.dumps(event_payload, default=str)
        dead_sockets: list[WebSocket] = []
        for ws in sockets:
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_text(payload_str)
            except Exception:
                dead_sockets.append(ws)

        if dead_sockets:
            for ws in dead_sockets:
                await self.disconnect_faculty(session_id, ws)

    async def _send_to_local_students(self, session_id: UUID, event_payload: dict[str, Any]) -> None:
        async with self._lock:
            sess_students = self._student_sockets.get(session_id, {})
            all_student_sockets: list[tuple[UUID, WebSocket]] = [
                (stud_id, ws)
                for stud_id, sockets in sess_students.items()
                for ws in sockets
            ]

        if not all_student_sockets:
            return

        payload_str = json.dumps(event_payload, default=str)
        for stud_id, ws in all_student_sockets:
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_text(payload_str)
            except Exception:
                await self.disconnect_student(session_id, stud_id, ws)


# Global default hub instance
global_room_hub = SessionRoomHub()

def fire_and_forget(coro: Any) -> None:
    """Schedules a coroutine on the running loop or closes it cleanly if no loop is running."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        if hasattr(coro, "close"):
            coro.close()
