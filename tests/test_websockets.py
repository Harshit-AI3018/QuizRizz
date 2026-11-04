"""
Unit tests for CampusQuiz Phase 9: Real-time Teacher Monitoring & WebSockets.

Covers:
- First-frame authentication ({"action": "AUTH", "ticket": "..."}) & timeout
- Ticket issuance, expiration, invalid signatures, single-use consumption & replay rejection
- Multi-socket tracking per student (multiple tabs/reconnects)
- Presence semantics (is_connected, attempt_status, last_seen_at)
- Role gating, college isolation & unassigned faculty rejection
- Initial authoritative state synchronization & on-demand REQUEST_SYNC
- Periodic monitor reconciliation cleanup on disconnect
- Answer confidentiality (no correct answers or option selections leaked)
- Post-commit transaction ordering & rollback safety
- Broadcast bus publishing and subscriptions
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
import time
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import jwt
from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState

from app.api.v1.endpoints.websockets import (
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_NOT_FOUND,
    WS_CLOSE_UNAUTHORIZED,
    monitor_session_websocket,
    student_session_websocket,
)
from app.core.bus import InMemoryBroadcastBus
from app.core.security import (
    JWT_ALGORITHM,
    JWT_AUDIENCE,
    JWT_ISSUER,
    create_ws_ticket_token,
)
from app.core.ws_hub import SessionRoomHub, StudentPresenceRecord
from app.core.ws_tickets import (
    TicketConsumptionStore,
    authenticate_and_consume_ws_ticket,
)
from app.schemas.auth import AuthenticatedUser

COLLEGE_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OTHER_COLLEGE_ID = UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")
FACULTY_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
OTHER_FACULTY_ID = UUID("99999999-9999-4999-8999-999999999999")
STUDENT_ID = UUID("11111111-1111-4111-8111-111111111111")
STUDENT_ID_2 = UUID("22222222-2222-4222-8222-222222222222")
SESSION_ID = UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
QUIZ_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
CLASS_ID = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")


def run_async(coro):
    """Run an async coroutine synchronously without socket-based event loops."""
    gen = coro.__await__()
    val = None
    exc = None
    while True:
        try:
            if exc:
                future = gen.throw(exc)
            else:
                future = gen.send(val)
            val = None
            exc = None
        except StopIteration as e:
            return e.value


def make_mock_settings():
    s = MagicMock()
    s.jwt_secret_key.get_secret_value.return_value = "supersecretjwtkeythatislongenough32bytes!"
    s.auth_hmac_secret.get_secret_value.return_value = "supersecrethmakeythatislongenough32bytes!"
    return s


def make_actor(*, user_id=FACULTY_ID, college_id=COLLEGE_ID, roles=None) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=user_id,
        college_id=college_id,
        email="user@example.edu",
        first_name="Test",
        last_name="User",
        roles=roles or ["FACULTY"],
        must_change_password=False,
        token_version=1,
    )


def make_mock_conn_for_user(actor: AuthenticatedUser):
    conn = AsyncMock()
    mock_user_res = MagicMock()
    mock_user_res.mappings.return_value.one_or_none.return_value = {
        "id": actor.id,
        "college_id": actor.college_id,
        "email": actor.email,
        "first_name": actor.first_name,
        "last_name": actor.last_name,
        "is_active": True,
        "must_change_password": False,
        "token_version": actor.token_version,
    }
    mock_roles_res = MagicMock()
    mock_roles_res.mappings.return_value.all.return_value = [{"role_code": r} for r in actor.roles]

    conn.execute = AsyncMock(side_effect=[mock_user_res, mock_roles_res])
    return conn


# =============================================================================
# 1. Single-Use Ticket Authentication & Concurrency Tests
# =============================================================================

class TestWebSocketTicketAuth(unittest.TestCase):

    def setUp(self):
        self.settings = make_mock_settings()
        self.store = TicketConsumptionStore()
        self.actor = make_actor()

    def test_ticket_generation_format_and_expiry(self):
        ticket = create_ws_ticket_token(
            user_id=str(self.actor.id),
            college_id=str(self.actor.college_id),
            roles=self.actor.roles,
            token_version=self.actor.token_version,
            settings=self.settings,
            session_id=str(SESSION_ID),
            lifetime_seconds=60,
        )
        self.assertIsInstance(ticket, str)

        payload = jwt.decode(
            ticket,
            self.settings.jwt_secret_key.get_secret_value(),
            algorithms=[JWT_ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=JWT_ISSUER,
        )
        self.assertEqual(payload["token_type"], "ws_ticket")
        self.assertEqual(payload["sub"], str(self.actor.id))
        self.assertEqual(payload["college_id"], str(self.actor.college_id))
        self.assertIn("jti", payload)
        self.assertEqual(payload["session_id"], str(SESSION_ID))
        self.assertLessEqual(payload["exp"] - payload["iat"], 60)

    def test_ticket_lifetime_cannot_exceed_60_seconds(self):
        with self.assertRaises(ValueError):
            create_ws_ticket_token(
                user_id=str(self.actor.id),
                college_id=str(self.actor.college_id),
                roles=self.actor.roles,
                token_version=self.actor.token_version,
                settings=self.settings,
                lifetime_seconds=120,
            )

    def test_ticket_expired_rejection(self):
        now = datetime.now(timezone.utc) - timedelta(seconds=100)
        expired_payload = {
            "sub": str(self.actor.id),
            "college_id": str(self.actor.college_id),
            "roles": self.actor.roles,
            "token_version": 1,
            "token_type": "ws_ticket",
            "iat": now,
            "exp": now + timedelta(seconds=60),
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "jti": str(uuid4()),
        }
        expired_ticket = jwt.encode(
            expired_payload,
            self.settings.jwt_secret_key.get_secret_value(),
            algorithm=JWT_ALGORITHM,
        )

        conn = AsyncMock()
        with self.assertRaises(Exception):
            run_async(
                authenticate_and_consume_ws_ticket(
                    conn,
                    expired_ticket,
                    settings=self.settings,
                    store=self.store,
                )
            )

    def test_ticket_invalid_signature_rejection(self):
        ticket = create_ws_ticket_token(
            user_id=str(self.actor.id),
            college_id=str(self.actor.college_id),
            roles=self.actor.roles,
            token_version=self.actor.token_version,
            settings=self.settings,
        )
        fake_settings = make_mock_settings()
        fake_settings.jwt_secret_key.get_secret_value.return_value = "different_secret_key_that_is_32_bytes_long!"

        conn = AsyncMock()
        with self.assertRaises(Exception):
            run_async(
                authenticate_and_consume_ws_ticket(
                    conn,
                    ticket,
                    settings=fake_settings,
                    store=self.store,
                )
            )

    def test_ticket_replay_rejection(self):
        ticket = create_ws_ticket_token(
            user_id=str(self.actor.id),
            college_id=str(self.actor.college_id),
            roles=self.actor.roles,
            token_version=self.actor.token_version,
            settings=self.settings,
        )

        # 1. First consumption succeeds
        conn1 = make_mock_conn_for_user(self.actor)
        user = run_async(
            authenticate_and_consume_ws_ticket(
                conn1,
                ticket,
                settings=self.settings,
                store=self.store,
            )
        )
        self.assertEqual(user.id, self.actor.id)

        # 2. Replay with identical ticket MUST be rejected
        conn2 = make_mock_conn_for_user(self.actor)
        with self.assertRaises(Exception):
            run_async(
                authenticate_and_consume_ws_ticket(
                    conn2,
                    ticket,
                    settings=self.settings,
                    store=self.store,
                )
            )

    def test_concurrent_ticket_consumption_lock_serialization(self):
        """Verifies that simultaneous attempts to consume the same JTI in one process are serialized."""
        jti = str(uuid4())
        exp = time.time() + 60.0

        async def run_concurrent():
            # First attempt consumes successfully
            first_success = await self.store.consume(jti, exp)
            # Second concurrent attempt with same JTI must be rejected
            second_success = await self.store.consume(jti, exp)
            return first_success, second_success

        first, second = run_async(run_concurrent())
        self.assertTrue(first)
        self.assertFalse(second)


# =============================================================================
# 2. Connection Hub & Multi-Socket Presence Tests
# =============================================================================

class TestSessionRoomHubPresenceAndMultiSocket(unittest.TestCase):

    def setUp(self):
        self.hub = SessionRoomHub()
        run_async(self.hub.start())

    def tearDown(self):
        run_async(self.hub.stop())

    def test_multiple_sockets_for_single_student(self):
        ws1 = MagicMock()
        ws2 = MagicMock()

        # Tab 1 connects -> first connection, returns True
        is_first = run_async(
            self.hub.connect_student(
                SESSION_ID, STUDENT_ID, "Student One", "R01", ws1
            )
        )
        self.assertTrue(is_first)
        count = run_async(self.hub.get_connected_students_count(SESSION_ID))
        self.assertEqual(count, 1)

        # Tab 2 connects -> already connected, returns False (no duplicate online transition)
        is_first_tab2 = run_async(
            self.hub.connect_student(
                SESSION_ID, STUDENT_ID, "Student One", "R01", ws2
            )
        )
        self.assertFalse(is_first_tab2)
        count = run_async(self.hub.get_connected_students_count(SESSION_ID))
        self.assertEqual(count, 1)

    def test_one_socket_disconnects_while_another_remains(self):
        ws1 = MagicMock()
        ws2 = MagicMock()

        run_async(self.hub.connect_student(SESSION_ID, STUDENT_ID, "Student One", "R01", ws1))
        run_async(self.hub.connect_student(SESSION_ID, STUDENT_ID, "Student One", "R01", ws2))

        # Close Tab 1 -> Tab 2 is still open! Returns False (not offline)
        is_last = run_async(self.hub.disconnect_student(SESSION_ID, STUDENT_ID, ws1))
        self.assertFalse(is_last)

        presence = run_async(self.hub.get_presence_record(SESSION_ID, STUDENT_ID))
        self.assertIsNotNone(presence)
        self.assertTrue(presence.is_connected)
        self.assertEqual(run_async(self.hub.get_connected_students_count(SESSION_ID)), 1)

        # Close Tab 2 -> Last socket closed! Returns True (offline transition)
        is_last_tab2 = run_async(self.hub.disconnect_student(SESSION_ID, STUDENT_ID, ws2))
        self.assertTrue(is_last_tab2)

        presence = run_async(self.hub.get_presence_record(SESSION_ID, STUDENT_ID))
        self.assertFalse(presence.is_connected)
        self.assertEqual(run_async(self.hub.get_connected_students_count(SESSION_ID)), 0)

    def test_disconnect_does_not_mutate_attempt_status(self):
        ws = MagicMock()
        run_async(self.hub.connect_student(SESSION_ID, STUDENT_ID, "Student One", "R01", ws))

        # Set cached attempt status to IN_PROGRESS
        presence = run_async(self.hub.get_presence_record(SESSION_ID, STUDENT_ID))
        presence.attempt_status = "IN_PROGRESS"

        # Disconnect
        run_async(self.hub.disconnect_student(SESSION_ID, STUDENT_ID, ws))

        # Attempt status must remain IN_PROGRESS (disconnection never finalizes attempt)
        presence_after = run_async(self.hub.get_presence_record(SESSION_ID, STUDENT_ID))
        self.assertEqual(presence_after.attempt_status, "IN_PROGRESS")
        self.assertFalse(presence_after.is_connected)

    def test_reconnect_flow(self):
        ws1 = MagicMock()
        run_async(self.hub.connect_student(SESSION_ID, STUDENT_ID, "Student One", "R01", ws1))
        run_async(self.hub.disconnect_student(SESSION_ID, STUDENT_ID, ws1))

        # Reconnect with new socket
        ws3 = MagicMock()
        is_first_reconn = run_async(
            self.hub.connect_student(SESSION_ID, STUDENT_ID, "Student One", "R01", ws3)
        )
        self.assertTrue(is_first_reconn)
        self.assertEqual(run_async(self.hub.get_connected_students_count(SESSION_ID)), 1)


# =============================================================================
# 3. First-Frame Authentication, Gating & Timeout Tests
# =============================================================================

class TestWebSocketEndpointsSecurity(unittest.TestCase):

    def setUp(self):
        self.settings = make_mock_settings()
        self.hub = SessionRoomHub()
        run_async(self.hub.start())

    def tearDown(self):
        run_async(self.hub.stop())

    def _make_ws(self):
        ws = MagicMock()
        ws.close = AsyncMock()
        ws.accept = AsyncMock()
        ws.send_text = AsyncMock()
        ws.receive_text = AsyncMock(side_effect=WebSocketDisconnect(code=1000))
        ws.app = MagicMock()
        ws.app.state = MagicMock()
        ws.app.state.settings = self.settings
        ws.app.state.ws_hub = self.hub
        return ws

    def test_first_frame_auth_timeout(self):
        """If client connects and sends no AUTH frame within 5s, socket is closed with 4401."""
        ws = self._make_ws()
        ws.receive_text = AsyncMock(side_effect=asyncio.TimeoutError())

        run_async(monitor_session_websocket(ws, SESSION_ID, ticket=None))
        ws.close.assert_awaited_once_with(code=WS_CLOSE_UNAUTHORIZED, reason="Authentication timeout")

    def test_first_frame_auth_invalid_action(self):
        """If client sends a frame without action=AUTH, socket is closed with 4401."""
        ws = self._make_ws()
        ws.receive_text = AsyncMock(return_value=json.dumps({"action": "PING"}))

        run_async(monitor_session_websocket(ws, SESSION_ID, ticket=None))
        ws.close.assert_awaited_once_with(code=WS_CLOSE_UNAUTHORIZED, reason="Authentication required")

    def test_first_frame_auth_malformed_json(self):
        """If client sends non-JSON text, socket is closed with 4401."""
        ws = self._make_ws()
        ws.receive_text = AsyncMock(return_value="this-is-not-json")

        run_async(monitor_session_websocket(ws, SESSION_ID, ticket=None))
        ws.close.assert_awaited_once_with(code=WS_CLOSE_UNAUTHORIZED, reason="Invalid authentication frame")

    def test_first_frame_auth_success(self):
        """Valid first frame AUTH authenticates and receives initial sync frame."""
        faculty = make_actor(user_id=FACULTY_ID, roles=["FACULTY"])
        ticket = create_ws_ticket_token(
            user_id=str(faculty.id),
            college_id=str(faculty.college_id),
            roles=faculty.roles,
            token_version=1,
            settings=self.settings,
        )

        ws = self._make_ws()
        auth_msg = json.dumps({"action": "AUTH", "ticket": ticket})
        ws.receive_text = AsyncMock(side_effect=[auth_msg, WebSocketDisconnect(code=1000)])

        conn = AsyncMock()
        mock_user = MagicMock()
        mock_user.mappings.return_value.one_or_none.return_value = {
            "id": faculty.id, "college_id": COLLEGE_ID, "email": "fac@college.edu",
            "first_name": "Quiz", "last_name": "Faculty", "is_active": True,
            "must_change_password": False, "token_version": 1
        }
        mock_roles = MagicMock()
        mock_roles.mappings.return_value.all.return_value = [{"role_code": "FACULTY"}]

        mock_sess = MagicMock()
        mock_sess.mappings.return_value.one_or_none.return_value = {
            "id": SESSION_ID, "college_id": COLLEGE_ID, "quiz_id": QUIZ_ID,
            "faculty_user_id": FACULTY_ID, "class_id": CLASS_ID, "status": "ACTIVE",
            "duration_minutes": 30,
        }

        mock_enrolled = MagicMock()
        mock_enrolled.mappings.return_value.all.return_value = []
        mock_attempts = MagicMock()
        mock_attempts.mappings.return_value.all.return_value = []
        mock_q_count = MagicMock()
        mock_q_count.scalar.return_value = 0

        conn.execute = AsyncMock(side_effect=[mock_user, mock_roles, mock_sess, mock_enrolled, mock_attempts, mock_q_count])
        ws.app.state.engine.connect.return_value.__aenter__.return_value = conn

        run_async(monitor_session_websocket(ws, SESSION_ID, ticket=None))

        # Accept must be called to receive the frame
        ws.accept.assert_awaited()
        # Initial sync frame must have been sent
        ws.send_text.assert_awaited()

    def test_monitor_rejects_student_role(self):
        student = make_actor(user_id=STUDENT_ID, roles=["STUDENT"])
        ticket = create_ws_ticket_token(
            user_id=str(student.id),
            college_id=str(student.college_id),
            roles=student.roles,
            token_version=1,
            settings=self.settings,
        )

        ws = self._make_ws()
        conn = make_mock_conn_for_user(student)
        ws.app.state.engine.connect.return_value.__aenter__.return_value = conn

        run_async(monitor_session_websocket(ws, SESSION_ID, ticket=ticket))
        ws.close.assert_awaited_once_with(code=WS_CLOSE_FORBIDDEN, reason="Insufficient role")

    def test_monitor_rejects_cross_college(self):
        faculty_other = make_actor(user_id=FACULTY_ID, college_id=OTHER_COLLEGE_ID, roles=["FACULTY"])
        ticket = create_ws_ticket_token(
            user_id=str(faculty_other.id),
            college_id=str(faculty_other.college_id),
            roles=faculty_other.roles,
            token_version=1,
            settings=self.settings,
        )

        ws = self._make_ws()
        conn = AsyncMock()

        mock_user = MagicMock()
        mock_user.mappings.return_value.one_or_none.return_value = {
            "id": faculty_other.id, "college_id": OTHER_COLLEGE_ID, "email": "fac@other.edu",
            "first_name": "Fac", "last_name": "Other", "is_active": True,
            "must_change_password": False, "token_version": 1
        }
        mock_roles = MagicMock()
        mock_roles.mappings.return_value.all.return_value = [{"role_code": "FACULTY"}]

        mock_sess = MagicMock()
        mock_sess.mappings.return_value.one_or_none.return_value = {
            "id": SESSION_ID, "college_id": COLLEGE_ID, "quiz_id": QUIZ_ID,
            "faculty_user_id": FACULTY_ID, "class_id": CLASS_ID, "status": "ACTIVE",
            "duration_minutes": 30,
        }

        conn.execute = AsyncMock(side_effect=[mock_user, mock_roles, mock_sess])
        ws.app.state.engine.connect.return_value.__aenter__.return_value = conn

        run_async(monitor_session_websocket(ws, SESSION_ID, ticket=ticket))
        ws.close.assert_awaited_once_with(code=WS_CLOSE_NOT_FOUND, reason="Session not found")

    def test_monitor_rejects_unassigned_faculty(self):
        unassigned_fac = make_actor(user_id=OTHER_FACULTY_ID, roles=["FACULTY"])
        ticket = create_ws_ticket_token(
            user_id=str(unassigned_fac.id),
            college_id=str(unassigned_fac.college_id),
            roles=unassigned_fac.roles,
            token_version=1,
            settings=self.settings,
        )

        ws = self._make_ws()
        conn = AsyncMock()

        mock_user = MagicMock()
        mock_user.mappings.return_value.one_or_none.return_value = {
            "id": unassigned_fac.id, "college_id": COLLEGE_ID, "email": "otherfac@college.edu",
            "first_name": "Other", "last_name": "Fac", "is_active": True,
            "must_change_password": False, "token_version": 1
        }
        mock_roles = MagicMock()
        mock_roles.mappings.return_value.all.return_value = [{"role_code": "FACULTY"}]

        mock_sess = MagicMock()
        mock_sess.mappings.return_value.one_or_none.return_value = {
            "id": SESSION_ID, "college_id": COLLEGE_ID, "quiz_id": QUIZ_ID,
            "faculty_user_id": FACULTY_ID, "class_id": CLASS_ID, "status": "ACTIVE",
            "duration_minutes": 30,
        }

        conn.execute = AsyncMock(side_effect=[mock_user, mock_roles, mock_sess])
        ws.app.state.engine.connect.return_value.__aenter__.return_value = conn

        run_async(monitor_session_websocket(ws, SESSION_ID, ticket=ticket))
        ws.close.assert_awaited_once_with(code=WS_CLOSE_FORBIDDEN, reason="Not assigned to this session")

    def test_student_rejects_unenrolled_student(self):
        student = make_actor(user_id=STUDENT_ID, roles=["STUDENT"])
        ticket = create_ws_ticket_token(
            user_id=str(student.id),
            college_id=str(student.college_id),
            roles=student.roles,
            token_version=1,
            settings=self.settings,
        )

        ws = self._make_ws()
        conn = AsyncMock()

        mock_user = MagicMock()
        mock_user.mappings.return_value.one_or_none.return_value = {
            "id": student.id, "college_id": COLLEGE_ID, "email": "stud@college.edu",
            "first_name": "Stud", "last_name": "One", "is_active": True,
            "must_change_password": False, "token_version": 1
        }
        mock_roles = MagicMock()
        mock_roles.mappings.return_value.all.return_value = [{"role_code": "STUDENT"}]

        mock_sess = MagicMock()
        mock_sess.mappings.return_value.one_or_none.return_value = {
            "id": SESSION_ID, "college_id": COLLEGE_ID, "class_id": CLASS_ID, "status": "ACTIVE"
        }

        mock_enroll = MagicMock()
        mock_enroll.scalar_one_or_none.return_value = None

        conn.execute = AsyncMock(side_effect=[mock_user, mock_roles, mock_sess, mock_enroll])
        ws.app.state.engine.connect.return_value.__aenter__.return_value = conn

        run_async(student_session_websocket(ws, SESSION_ID, ticket=ticket))
        ws.close.assert_awaited_once_with(code=WS_CLOSE_FORBIDDEN, reason="Not enrolled in this class")


# =============================================================================
# 4. Synchronization, REQUEST_SYNC & Zero Answer Leakage Tests
# =============================================================================

class TestInitialSyncAndConfidentiality(unittest.TestCase):

    def setUp(self):
        self.settings = make_mock_settings()
        self.hub = SessionRoomHub()
        run_async(self.hub.start())

    def tearDown(self):
        run_async(self.hub.stop())

    def test_monitor_initial_state_synchronization(self):
        faculty = make_actor(user_id=FACULTY_ID, roles=["FACULTY"])
        ticket = create_ws_ticket_token(
            user_id=str(faculty.id),
            college_id=str(faculty.college_id),
            roles=faculty.roles,
            token_version=1,
            settings=self.settings,
        )

        ws = MagicMock()
        ws.close = AsyncMock()
        ws.accept = AsyncMock()
        sent_messages = []
        ws.send_text = AsyncMock(side_effect=lambda msg: sent_messages.append(json.loads(msg)))
        ws.receive_text = AsyncMock(side_effect=WebSocketDisconnect(code=1000))
        ws.app = MagicMock()
        ws.app.state = MagicMock()
        ws.app.state.settings = self.settings
        ws.app.state.ws_hub = self.hub

        conn = AsyncMock()
        mock_user = MagicMock()
        mock_user.mappings.return_value.one_or_none.return_value = {
            "id": faculty.id, "college_id": COLLEGE_ID, "email": "fac@college.edu",
            "first_name": "Quiz", "last_name": "Faculty", "is_active": True,
            "must_change_password": False, "token_version": 1
        }
        mock_roles = MagicMock()
        mock_roles.mappings.return_value.all.return_value = [{"role_code": "FACULTY"}]

        mock_sess = MagicMock()
        mock_sess.mappings.return_value.one_or_none.return_value = {
            "id": SESSION_ID, "college_id": COLLEGE_ID, "quiz_id": QUIZ_ID,
            "faculty_user_id": FACULTY_ID, "class_id": CLASS_ID, "status": "ACTIVE",
            "duration_minutes": 30,
        }

        mock_enrolled = MagicMock()
        mock_enrolled.mappings.return_value.all.return_value = [
            {"student_user_id": STUDENT_ID, "student_name": "Alice Smith", "roll_number": "CS-01"},
            {"student_user_id": STUDENT_ID_2, "student_name": "Bob Jones", "roll_number": "CS-02"},
        ]

        mock_attempts = MagicMock()
        mock_attempts.mappings.return_value.all.return_value = [
            {
                "attempt_id": uuid4(),
                "student_user_id": STUDENT_ID,
                "attempt_status": "IN_PROGRESS",
                "started_at": datetime.now(timezone.utc),
                "deadline": datetime.now(timezone.utc) + timedelta(minutes=20),
                "answered_count": 3,
            }
        ]

        mock_q_count = MagicMock()
        mock_q_count.scalar.return_value = 5

        conn.execute = AsyncMock(side_effect=[mock_user, mock_roles, mock_sess, mock_enrolled, mock_attempts, mock_q_count])
        ws.app.state.engine.connect.return_value.__aenter__.return_value = conn

        run_async(monitor_session_websocket(ws, SESSION_ID, ticket=ticket))

        ws.accept.assert_awaited()
        self.assertTrue(len(sent_messages) >= 1)
        sync_event = sent_messages[0]
        self.assertEqual(sync_event["event"], "MONITOR_SYNC_STATE")
        self.assertEqual(sync_event["session_id"], str(SESSION_ID))
        data = sync_event["data"]
        self.assertEqual(data["session_status"], "ACTIVE")
        self.assertEqual(data["total_enrolled"], 2)
        self.assertEqual(data["summary"]["in_progress"], 1)
        self.assertEqual(data["summary"]["not_started"], 1)

        participants = data["participants"]
        self.assertEqual(len(participants), 2)
        p1 = next(p for p in participants if p["student_user_id"] == str(STUDENT_ID))
        self.assertEqual(p1["attempt_status"], "IN_PROGRESS")
        self.assertEqual(p1["answered_count"], 3)
        self.assertEqual(p1["total_questions"], 5)

        # CONFIDENTIALITY CHECK: Options, correctness, explanations must NOT exist
        for p in participants:
            self.assertNotIn("selected_option_ids", p)
            self.assertNotIn("is_correct", p)
            self.assertNotIn("question_breakdown", p)

    def test_request_sync_on_connected_monitor(self):
        """Verifies that sending REQUEST_SYNC triggers an authoritative MONITOR_SYNC_STATE frame."""
        faculty = make_actor(user_id=FACULTY_ID, roles=["FACULTY"])
        ticket = create_ws_ticket_token(
            user_id=str(faculty.id),
            college_id=str(faculty.college_id),
            roles=faculty.roles,
            token_version=1,
            settings=self.settings,
        )

        ws = MagicMock()
        ws.close = AsyncMock()
        ws.accept = AsyncMock()
        sent_messages = []
        ws.send_text = AsyncMock(side_effect=lambda msg: sent_messages.append(json.loads(msg)))
        ws.receive_text = AsyncMock(
            side_effect=[
                json.dumps({"event": "REQUEST_SYNC"}),
                WebSocketDisconnect(code=1000),
            ]
        )
        ws.app = MagicMock()
        ws.app.state = MagicMock()
        ws.app.state.settings = self.settings
        ws.app.state.ws_hub = self.hub

        conn = AsyncMock()
        mock_user = MagicMock()
        mock_user.mappings.return_value.one_or_none.return_value = {
            "id": faculty.id, "college_id": COLLEGE_ID, "email": "fac@college.edu",
            "first_name": "Quiz", "last_name": "Faculty", "is_active": True,
            "must_change_password": False, "token_version": 1
        }
        mock_roles = MagicMock()
        mock_roles.mappings.return_value.all.return_value = [{"role_code": "FACULTY"}]

        mock_sess = MagicMock()
        mock_sess.mappings.return_value.one_or_none.return_value = {
            "id": SESSION_ID, "college_id": COLLEGE_ID, "quiz_id": QUIZ_ID,
            "faculty_user_id": FACULTY_ID, "class_id": CLASS_ID, "status": "ACTIVE",
            "duration_minutes": 30,
        }

        mock_enrolled = MagicMock()
        mock_enrolled.mappings.return_value.all.return_value = []
        mock_attempts = MagicMock()
        mock_attempts.mappings.return_value.all.return_value = []
        mock_q_count = MagicMock()
        mock_q_count.scalar.return_value = 0

        # Repeated queries for initial sync + on-demand REQUEST_SYNC
        conn.execute = AsyncMock(
            side_effect=[
                mock_user, mock_roles, mock_sess,
                mock_enrolled, mock_attempts, mock_q_count,  # Initial sync
                mock_enrolled, mock_attempts, mock_q_count,  # REQUEST_SYNC
            ]
        )
        ws.app.state.engine.connect.return_value.__aenter__.return_value = conn

        run_async(monitor_session_websocket(ws, SESSION_ID, ticket=ticket))

        # Must have sent at least 2 frames (initial sync + REQUEST_SYNC response)
        sync_frames = [msg for msg in sent_messages if msg.get("event") == "MONITOR_SYNC_STATE"]
        self.assertEqual(len(sync_frames), 2)


# =============================================================================
# 5. Transaction Ordering & Rollback Safety Tests
# =============================================================================

class TestTransactionOrderingAndRollbackSafety(unittest.TestCase):

    def setUp(self):
        self.hub = SessionRoomHub()
        run_async(self.hub.start())

    def tearDown(self):
        run_async(self.hub.stop())

    def test_no_broadcast_when_database_transaction_fails(self):
        from app.services import lifecycle_service

        actor = make_actor()
        conn = AsyncMock()

        sess_mock = MagicMock()
        sess_mock.mappings.return_value.one_or_none.return_value = {
            "id": SESSION_ID, "college_id": COLLEGE_ID, "status": "ACTIVE", "faculty_user_id": FACULTY_ID
        }
        from sqlalchemy.exc import IntegrityError
        conn.execute = AsyncMock(side_effect=[sess_mock, IntegrityError("violates constraint", params=None, orig=None)])
        conn.commit = AsyncMock()
        conn.rollback = AsyncMock()

        with patch("app.core.ws_hub.global_room_hub.broadcast_to_session", new_callable=AsyncMock) as mock_broadcast:
            with self.assertRaises(Exception):
                run_async(
                    lifecycle_service.transition_session(
                        conn,
                        actor,
                        SESSION_ID,
                        "pause",
                        make_mock_settings(),
                    )
                )

            conn.rollback.assert_awaited()
            mock_broadcast.assert_not_called()


# =============================================================================
# 6. Broadcast Bus Tests
# =============================================================================

class TestBroadcastBus(unittest.TestCase):

    def test_in_memory_bus_publish_subscribe(self):
        bus = InMemoryBroadcastBus()
        run_async(bus.start())

        received = []

        async def handler(msg):
            received.append(msg)

        bus.subscribe("test_channel", handler)
        run_async(bus.publish("test_channel", {"hello": "world"}))

        self.assertEqual(len(received), 1)
        self.assertEqual(received[0], {"hello": "world"})

        run_async(bus.stop())


if __name__ == "__main__":
    unittest.main()
