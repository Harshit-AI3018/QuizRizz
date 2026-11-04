"""
WebSocket endpoints for live quiz session monitoring and student presence.

Features:
- First-frame authentication ({"action": "AUTH", "ticket": "..."}) with 5-second timeout
- Elimination of ticket leakage in query strings and reverse-proxy logs
- Authoritative initial state synchronization (MONITOR_SYNC_STATE)
- Client-triggered on-demand sync ({"event": "REQUEST_SYNC"})
- Periodic monitor reconciliation (every ~30 seconds) with guaranteed task cleanup
- Multi-connection per student tracking and clean disconnect handling
- Zero answer / score leakage
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import logging
from typing import Any, Mapping
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.core.config import Settings
from app.core.ws_hub import SessionRoomHub, global_room_hub
from app.core.ws_tickets import authenticate_and_consume_ws_ticket
from app.schemas.auth import AuthenticatedUser

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websockets"])

WS_CLOSE_UNAUTHORIZED = 4401
WS_CLOSE_FORBIDDEN = 4403
WS_CLOSE_NOT_FOUND = 4404


def _is_admin(actor: AuthenticatedUser) -> bool:
    return "ADMIN" in actor.roles


async def _get_hub(websocket: WebSocket) -> SessionRoomHub:
    state = getattr(websocket.app, "state", None)
    if state is not None and getattr(state, "ws_hub", None) is not None:
        return state.ws_hub
    return global_room_hub


async def _get_settings(websocket: WebSocket) -> Settings:
    state = getattr(websocket.app, "state", None)
    if state is not None and getattr(state, "settings", None) is not None:
        return state.settings
    from app.core.config import Settings as ConfigSettings
    return ConfigSettings()


async def _receive_with_timeout(websocket: WebSocket, timeout: float = 5.0) -> str:
    try:
        loop = asyncio.get_running_loop()
        return await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
    except RuntimeError:
        return await websocket.receive_text()


async def _extract_auth_ticket(websocket: WebSocket, query_ticket: str | None = None) -> tuple[str, bool]:
    """
    Extracts authentication ticket.
    Supports first-frame authentication: waits for {"action": "AUTH", "ticket": "..."} within 5.0s.
    Returns (ticket, was_accepted_early).
    """
    if query_ticket:
        return query_ticket, False

    # Accept connection initially to receive the first JSON frame
    await websocket.accept()
    try:
        raw_msg = await _receive_with_timeout(websocket, timeout=5.0)
    except (asyncio.TimeoutError, TimeoutError):
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason="Authentication timeout")
        raise
    except WebSocketDisconnect:
        raise

    try:
        data = json.loads(raw_msg)
        if not isinstance(data, dict) or data.get("action") != "AUTH":
            await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason="Authentication required")
            raise ValueError("Expected action AUTH")
        ticket = data.get("ticket")
        if not isinstance(ticket, str) or not ticket:
            await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason="Missing authentication ticket")
            raise ValueError("Missing ticket")
        return ticket, True
    except (json.JSONDecodeError, TypeError):
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason="Invalid authentication frame")
        raise


async def _build_monitor_sync_state(
    connection: AsyncConnection,
    hub: SessionRoomHub,
    session_id: UUID,
    actor: AuthenticatedUser,
    session: Mapping[str, Any],
) -> dict[str, Any]:
    """Builds the authoritative full synchronization state from PostgreSQL."""
    enrolled_res = await connection.execute(
        text(
            """
            SELECT se.student_user_id,
                   TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS student_name,
                   sp.roll_number
            FROM student_enrollments se
            JOIN users u ON u.id = se.student_user_id
            LEFT JOIN student_profiles sp ON sp.user_id = se.student_user_id
            WHERE se.college_id = :college_id
              AND se.class_id = :class_id
              AND se.is_active = TRUE
            ORDER BY sp.roll_number ASC, u.last_name ASC, u.first_name ASC
            """
        ),
        {"college_id": actor.college_id, "class_id": session["class_id"]},
    )
    enrolled = list(enrolled_res.mappings().all())

    attempts_res = await connection.execute(
        text(
            """
            SELECT qa.id AS attempt_id,
                   qa.student_user_id,
                   qa.status AS attempt_status,
                   qa.started_at,
                   qa.deadline,
                   COUNT(sr.id) AS answered_count
            FROM quiz_attempts qa
            LEFT JOIN student_responses sr ON sr.attempt_id = qa.id
            WHERE qa.session_id = :session_id
            GROUP BY qa.id, qa.student_user_id, qa.status, qa.started_at, qa.deadline
            """
        ),
        {"session_id": session_id},
    )
    attempts_map = {row["student_user_id"]: row for row in attempts_res.mappings().all()}

    total_q_res = await connection.execute(
        text(
            """
            SELECT COUNT(*)
            FROM quiz_questions
            WHERE quiz_id = :quiz_id
            """
        ),
        {"quiz_id": session["quiz_id"]},
    )
    total_questions = total_q_res.scalar() or 0

    now = datetime.now(timezone.utc)
    all_presence = await hub.get_all_presence(session_id)
    connected_count = await hub.get_connected_students_count(session_id)

    participants = []
    summary = {"not_started": 0, "in_progress": 0, "submitted": 0, "timed_out": 0}

    for stud in enrolled:
        s_id = stud["student_user_id"]
        att = attempts_map.get(s_id)
        presence = all_presence.get(s_id)

        if att is None:
            att_status = "NOT_STARTED"
            summary["not_started"] += 1
            att_id = None
            answered_cnt = 0
            started_at = None
            time_remaining = None
        elif att["attempt_status"] == "IN_PROGRESS":
            att_status = "IN_PROGRESS"
            summary["in_progress"] += 1
            att_id = att["attempt_id"]
            answered_cnt = int(att["answered_count"])
            started_at = att["started_at"]
            deadline = att["deadline"]
            time_remaining = max(0, int((deadline - now).total_seconds())) if deadline else None
        else:
            att_status = "FINALIZED"
            summary["submitted"] += 1
            att_id = att["attempt_id"]
            answered_cnt = int(att["answered_count"])
            started_at = att["started_at"]
            time_remaining = 0

        is_conn = presence.is_connected if presence else False
        last_seen = presence.last_seen_at.isoformat() if presence and presence.last_seen_at else None

        participants.append(
            {
                "student_user_id": str(s_id),
                "student_name": stud["student_name"],
                "roll_number": stud["roll_number"],
                "attempt_id": str(att_id) if att_id else None,
                "attempt_status": att_status,
                "is_connected": is_conn,
                "last_seen_at": last_seen,
                "answered_count": answered_cnt,
                "total_questions": total_questions,
                "started_at": started_at.isoformat() if started_at else None,
                "time_remaining_seconds": time_remaining,
            }
        )

    return {
        "event": "MONITOR_SYNC_STATE",
        "session_id": str(session_id),
        "timestamp": now.isoformat(),
        "data": {
            "session_id": str(session_id),
            "session_status": session["status"],
            "total_enrolled": len(enrolled),
            "connected_students_count": connected_count,
            "summary": summary,
            "participants": participants,
        },
    }


@router.websocket("/ws/sessions/{session_id}/monitor")
async def monitor_session_websocket(
    websocket: WebSocket,
    session_id: UUID,
    ticket: str | None = Query(None),
) -> None:
    """
    Teacher-only WebSocket for real-time monitoring of a quiz session.
    Authenticates via first frame {"action": "AUTH", "ticket": "..."} within 5s (or query ticket).
    """
    try:
        auth_ticket, accepted_early = await _extract_auth_ticket(websocket, query_ticket=ticket)
    except Exception:
        return

    settings = await _get_settings(websocket)
    hub = await _get_hub(websocket)
    engine = websocket.app.state.engine

    async with engine.connect() as connection:
        # 1. Authenticate and consume the single-use ticket
        try:
            actor = await authenticate_and_consume_ws_ticket(
                connection,
                auth_ticket,
                settings=settings,
                expected_session_id=session_id,
            )
        except Exception:
            await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason="Invalid or expired ticket")
            return

        # 2. Check role authorization (Faculty or Admin only)
        if not (set(actor.roles).intersection({"FACULTY", "ADMIN"})):
            await websocket.close(code=WS_CLOSE_FORBIDDEN, reason="Insufficient role")
            return

        # 3. Check session existence, college isolation, and ownership
        sess_res = await connection.execute(
            text(
                """
                SELECT id, college_id, quiz_id, faculty_user_id, class_id, status, duration_minutes
                FROM quiz_sessions
                WHERE id = :session_id
                """
            ),
            {"session_id": session_id},
        )
        session = sess_res.mappings().one_or_none()
        if session is None or session["college_id"] != actor.college_id:
            await websocket.close(code=WS_CLOSE_NOT_FOUND, reason="Session not found")
            return

        if not _is_admin(actor) and session["faculty_user_id"] != actor.id:
            await websocket.close(code=WS_CLOSE_FORBIDDEN, reason="Not assigned to this session")
            return

        # Build initial authoritative sync state
        sync_event = await _build_monitor_sync_state(connection, hub, session_id, actor, session)

    # 4. Accept connection if not accepted early during first-frame wait
    if not accepted_early:
        await websocket.accept()

    # 5. Join hub as authorized faculty monitor
    await hub.connect_faculty(session_id, websocket)

    # 6. Deliver initial sync frame
    await websocket.send_text(json.dumps(sync_event, default=str))

    # 7. Start periodic reconciliation task (~every 30 seconds)
    async def _periodic_monitor_sync():
        try:
            while True:
                await asyncio.sleep(30.0)
                try:
                    async with engine.connect() as p_conn:
                        p_sync = await _build_monitor_sync_state(p_conn, hub, session_id, actor, session)
                        await websocket.send_text(json.dumps(p_sync, default=str))
                except Exception:
                    break
        except asyncio.CancelledError:
            pass

    periodic_task = None
    try:
        loop = asyncio.get_running_loop()
        periodic_task = loop.create_task(_periodic_monitor_sync())
    except RuntimeError:
        pass

    # 8. Receive loop: handles PING/PONG and on-demand REQUEST_SYNC
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("event") == "PING":
                    await websocket.send_text(
                        json.dumps({"event": "PONG", "timestamp": datetime.now(timezone.utc).isoformat()})
                    )
                elif msg.get("event") == "REQUEST_SYNC":
                    async with engine.connect() as sync_conn:
                        req_sync = await _build_monitor_sync_state(sync_conn, hub, session_id, actor, session)
                        await websocket.send_text(json.dumps(req_sync, default=str))
            except Exception:
                continue
    except WebSocketDisconnect:
        pass
    finally:
        if periodic_task is not None:
            periodic_task.cancel()
        await hub.disconnect_faculty(session_id, websocket)


@router.websocket("/ws/sessions/{session_id}/student")
async def student_session_websocket(
    websocket: WebSocket,
    session_id: UUID,
    ticket: str | None = Query(None),
) -> None:
    """
    Student WebSocket for receiving session lifecycle events and tracking presence.
    Supports first-frame authentication {"action": "AUTH", "ticket": "..."} within 5s (or query ticket).
    Supports multiple concurrent connections per student (e.g. multi-tab).
    """
    try:
        auth_ticket, accepted_early = await _extract_auth_ticket(websocket, query_ticket=ticket)
    except Exception:
        return

    settings = await _get_settings(websocket)
    hub = await _get_hub(websocket)
    engine = websocket.app.state.engine

    async with engine.connect() as connection:
        # 1. Authenticate ticket
        try:
            actor = await authenticate_and_consume_ws_ticket(
                connection,
                auth_ticket,
                settings=settings,
                expected_session_id=session_id,
            )
        except Exception:
            await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason="Invalid or expired ticket")
            return

        # 2. Check role
        if "STUDENT" not in actor.roles:
            await websocket.close(code=WS_CLOSE_FORBIDDEN, reason="Only students can connect to student channel")
            return

        # 3. Check session and college isolation
        sess_res = await connection.execute(
            text(
                """
                SELECT id, college_id, class_id, status
                FROM quiz_sessions
                WHERE id = :session_id
                """
            ),
            {"session_id": session_id},
        )
        session = sess_res.mappings().one_or_none()
        if session is None or session["college_id"] != actor.college_id:
            await websocket.close(code=WS_CLOSE_NOT_FOUND, reason="Session not found")
            return

        # 4. Check student class enrollment
        enroll_res = await connection.execute(
            text(
                """
                SELECT 1
                FROM student_enrollments
                WHERE college_id = :college_id
                  AND class_id = :class_id
                  AND student_user_id = :student_id
                  AND is_active = TRUE
                """
            ),
            {
                "college_id": actor.college_id,
                "class_id": session["class_id"],
                "student_id": actor.id,
            },
        )
        if enroll_res.scalar_one_or_none() is None:
            await websocket.close(code=WS_CLOSE_FORBIDDEN, reason="Not enrolled in this class")
            return

        prof_res = await connection.execute(
            text(
                """
                SELECT roll_number
                FROM student_profiles
                WHERE college_id = :college_id
                  AND user_id = :user_id
                """
            ),
            {"college_id": actor.college_id, "user_id": actor.id},
        )
        prof = prof_res.mappings().one_or_none()
        roll_number = prof["roll_number"] if prof else None

    student_name = f"{actor.first_name} {actor.last_name or ''}".strip()

    # 5. Accept connection if not accepted early
    if not accepted_early:
        await websocket.accept()

    # 6. Register connection in hub (track multiple sockets per student)
    is_first_connection = await hub.connect_student(
        session_id=session_id,
        student_user_id=actor.id,
        student_name=student_name,
        roll_number=roll_number,
        socket=websocket,
    )

    now = datetime.now(timezone.utc)

    # 7. If this is the student's FIRST connection, notify faculty monitor of online status
    if is_first_connection:
        connected_count = await hub.get_connected_students_count(session_id)
        presence_event = {
            "event": "STUDENT_PRESENCE_UPDATED",
            "session_id": str(session_id),
            "timestamp": now.isoformat(),
            "data": {
                "student_user_id": str(actor.id),
                "student_name": student_name,
                "roll_number": roll_number,
                "is_connected": True,
                "last_seen_at": now.isoformat(),
                "connected_students_count": connected_count,
            },
        }
        await hub.broadcast_to_faculty(session_id, presence_event)

    # 8. Send current session status to the connected student
    status_event = {
        "event": "SESSION_STATUS_CHANGED",
        "session_id": str(session_id),
        "timestamp": now.isoformat(),
        "data": {
            "session_id": str(session_id),
            "previous_status": session["status"],
            "new_status": session["status"],
        },
    }
    await websocket.send_text(json.dumps(status_event, default=str))

    # 9. Receive / Heartbeat loop (No periodic DB queries for student sockets)
    try:
        while True:
            data = await websocket.receive_text()
            await hub.touch_student(session_id, actor.id)
            try:
                msg = json.loads(data)
                if msg.get("event") == "PING":
                    await websocket.send_text(
                        json.dumps({"event": "PONG", "timestamp": datetime.now(timezone.utc).isoformat()})
                    )
            except Exception:
                continue
    except WebSocketDisconnect:
        pass
    finally:
        is_last_connection = await hub.disconnect_student(session_id, actor.id, websocket)
        if is_last_connection:
            disconn_now = datetime.now(timezone.utc)
            connected_count = await hub.get_connected_students_count(session_id)
            presence_event = {
                "event": "STUDENT_PRESENCE_UPDATED",
                "session_id": str(session_id),
                "timestamp": disconn_now.isoformat(),
                "data": {
                    "student_user_id": str(actor.id),
                    "student_name": student_name,
                    "roll_number": roll_number,
                    "is_connected": False,
                    "last_seen_at": disconn_now.isoformat(),
                    "connected_students_count": connected_count,
                },
            }
            await hub.broadcast_to_faculty(session_id, presence_event)
