from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from pydantic import BaseModel, SecretStr
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.security import hash_password
from app.schemas.administration import FacultyCreate, FacultyUpdate, StudentCreate, StudentUpdate
from app.schemas.auth import AuthenticatedUser


@dataclass(frozen=True)
class Resource:
    table: str
    columns: tuple[str, ...]
    mutable_columns: frozenset[str]
    nullable_columns: frozenset[str] = frozenset()
    soft_delete: bool = False
    update_columns: frozenset[str] | None = None


_RESOURCES = {
    "academic_years": Resource(
        "academic_years",
        ("name", "start_date", "end_date", "is_current", "created_at", "updated_at"),
        frozenset({"name", "start_date", "end_date", "is_current"}),
    ),
    "departments": Resource(
        "departments",
        ("name", "code", "created_at", "updated_at"),
        frozenset({"name", "code"}),
    ),
    "branches": Resource(
        "branches",
        ("department_id", "name", "code", "created_at", "updated_at"),
        frozenset({"department_id", "name", "code"}),
    ),
    "classes": Resource(
        "classes",
        ("branch_id", "academic_year_id", "year_of_study", "semester", "section", "created_at", "updated_at"),
        frozenset({"branch_id", "academic_year_id", "year_of_study", "semester", "section"}),
    ),
    "subjects": Resource(
        "subjects",
        ("department_id", "name", "code", "created_at", "updated_at"),
        frozenset({"department_id", "name", "code"}),
    ),
    "faculty_assignments": Resource(
        "faculty_assignments",
        (
            "faculty_user_id",
            "subject_id",
            "class_id",
            "academic_year_id",
            "is_active",
            "created_at",
        ),
        frozenset({"faculty_user_id", "subject_id", "class_id", "academic_year_id", "is_active"}),
        soft_delete=True,
        update_columns=frozenset({"is_active"}),
    ),
    "student_enrollments": Resource(
        "student_enrollments",
        (
            "student_user_id",
            "class_id",
            "academic_year_id",
            "enrollment_type",
            "is_active",
            "created_at",
        ),
        frozenset({"student_user_id", "class_id", "academic_year_id", "enrollment_type", "is_active"}),
        soft_delete=True,
        update_columns=frozenset({"is_active"}),
    ),
}

_PROFILE_SELECTS = {
    "faculty": """
        SELECT u.id, u.college_id, u.email, u.first_name, u.last_name,
               u.is_active, u.must_change_password, fp.employee_id,
               fp.department_id, fp.designation, fp.created_at, fp.updated_at
        FROM faculty_profiles AS fp
        JOIN users AS u ON u.id = fp.user_id AND u.college_id = fp.college_id
        WHERE fp.college_id = :college_id
          AND EXISTS (
              SELECT 1 FROM user_roles AS ur
              WHERE ur.user_id = u.id AND ur.college_id = u.college_id
                AND ur.role_code = 'FACULTY'
          )
    """,
    "student": """
        SELECT u.id, u.college_id, u.email, u.first_name, u.last_name,
               u.is_active, u.must_change_password, sp.roll_number,
               sp.registration_number, sp.created_at, sp.updated_at
        FROM student_profiles AS sp
        JOIN users AS u ON u.id = sp.user_id AND u.college_id = sp.college_id
        WHERE sp.college_id = :college_id
          AND EXISTS (
              SELECT 1 FROM user_roles AS ur
              WHERE ur.user_id = u.id AND ur.college_id = u.college_id
                AND ur.role_code = 'STUDENT'
          )
    """,
}


async def _run_mutation(
    connection: AsyncConnection,
    operation: Callable[[], Awaitable[Any]],
) -> Any:
    try:
        result = await operation()
        await connection.commit()
        return result
    except IntegrityError as exc:
        await connection.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The change conflicts with existing institutional records",
        ) from exc
    except HTTPException:
        await connection.rollback()
        raise


def _resource(name: str) -> Resource:
    try:
        return _RESOURCES[name]
    except KeyError as exc:
        raise ValueError(f"Unknown administration resource: {name}") from exc


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")


async def _require_active_role(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    user_id: UUID,
    role_code: str,
    user_field: str,
) -> None:
    result = await connection.execute(
        text(
            """
            SELECT u.id
            FROM users AS u
            JOIN user_roles AS ur
              ON ur.user_id = u.id AND ur.college_id = u.college_id
            WHERE u.id = :user_id AND u.college_id = :college_id
              AND u.is_active = TRUE AND ur.role_code = :role_code
            """
        ),
        {
            "user_id": user_id,
            "college_id": actor.college_id,
            "role_code": role_code,
        },
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{user_field} must identify an active {role_code.lower()} in this college",
        )


async def get_college(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
) -> Mapping[str, Any]:
    result = await connection.execute(
        text(
            """
            SELECT id, name, code, is_active, created_at, updated_at
            FROM colleges WHERE id = :college_id
            """
        ),
        {"college_id": actor.college_id},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise _not_found()
    return row


async def update_college(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    values: Mapping[str, object],
) -> Mapping[str, Any]:
    if not values:
        raise HTTPException(status_code=422, detail="At least one field must be provided")
    if not values.keys() <= {"name", "code"}:
        raise HTTPException(status_code=422, detail="Invalid fields for college")
    if any(value is None for value in values.values()):
        raise HTTPException(status_code=422, detail="College fields cannot be null")
    assignments = ", ".join(f"{field} = :{field}" for field in values)

    async def operation() -> Mapping[str, Any]:
        result = await connection.execute(
            text(
                f"""
                UPDATE colleges SET {assignments}
                WHERE id = :college_id
                RETURNING id, name, code, is_active, created_at, updated_at
                """
            ),
            {**values, "college_id": actor.college_id},
        )
        row = result.mappings().one_or_none()
        if row is None:
            raise _not_found()
        return row

    return await _run_mutation(connection, operation)


async def list_resources(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    resource_name: str,
    *,
    limit: int,
    offset: int,
) -> list[Mapping[str, Any]]:
    resource = _resource(resource_name)
    selected_columns = ", ".join(resource.columns)
    result = await connection.execute(
        text(
            f"""
            SELECT id, college_id, {selected_columns}
            FROM {resource.table}
            WHERE college_id = :college_id
            ORDER BY created_at DESC, id
            LIMIT :limit OFFSET :offset
            """
        ),
        {"college_id": actor.college_id, "limit": limit, "offset": offset},
    )
    return list(result.mappings().all())


async def get_resource(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    resource_name: str,
    record_id: UUID,
) -> Mapping[str, Any]:
    resource = _resource(resource_name)
    selected_columns = ", ".join(resource.columns)
    result = await connection.execute(
        text(
            f"""
            SELECT id, college_id, {selected_columns}
            FROM {resource.table}
            WHERE college_id = :college_id AND id = :record_id
            """
        ),
        {"college_id": actor.college_id, "record_id": record_id},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise _not_found()
    return row


async def create_resource(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    resource_name: str,
    values: Mapping[str, object],
) -> Mapping[str, Any]:
    resource = _resource(resource_name)
    if not values or not values.keys() <= resource.mutable_columns:
        raise HTTPException(status_code=422, detail="Invalid fields for this resource")
    columns = ("college_id", *values.keys())
    column_sql = ", ".join(columns)
    value_sql = ", ".join(f":{column}" for column in columns)
    selected_columns = ", ".join(resource.columns)

    async def operation() -> Mapping[str, Any]:
        role_requirement = {
            "faculty_assignments": ("faculty_user_id", "FACULTY"),
            "student_enrollments": ("student_user_id", "STUDENT"),
        }.get(resource_name)
        if role_requirement is not None:
            user_field, role_code = role_requirement
            await _require_active_role(
                connection,
                actor,
                values[user_field],
                role_code,
                user_field,
            )
        result = await connection.execute(
            text(
                f"""
                INSERT INTO {resource.table} ({column_sql})
                VALUES ({value_sql})
                RETURNING id, college_id, {selected_columns}
                """
            ),
            {"college_id": actor.college_id, **values},
        )
        return result.mappings().one()

    return await _run_mutation(connection, operation)


async def update_resource(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    resource_name: str,
    record_id: UUID,
    values: Mapping[str, object],
) -> Mapping[str, Any]:
    resource = _resource(resource_name)
    allowed_update_columns = resource.update_columns or resource.mutable_columns
    if not values or not values.keys() <= allowed_update_columns:
        raise HTTPException(status_code=422, detail="Invalid fields for this resource")
    if any(value is None and key not in resource.nullable_columns for key, value in values.items()):
        raise HTTPException(status_code=422, detail="Required fields cannot be null")
    assignments = ", ".join(f"{field} = :{field}" for field in values)
    selected_columns = ", ".join(resource.columns)

    async def operation() -> Mapping[str, Any]:
        role_requirement = {
            "faculty_assignments": ("faculty_user_id", "FACULTY"),
            "student_enrollments": ("student_user_id", "STUDENT"),
        }.get(resource_name)
        if role_requirement is not None:
            user_field, role_code = role_requirement
            if values.get("is_active") is True:
                record_result = await connection.execute(
                    text(
                        f"""
                        SELECT {user_field}
                        FROM {resource.table}
                        WHERE college_id = :college_id AND id = :record_id
                        """
                    ),
                    {"college_id": actor.college_id, "record_id": record_id},
                )
                assigned_user_id = record_result.scalar_one_or_none()
                if assigned_user_id is None:
                    raise _not_found()
                await _require_active_role(
                    connection,
                    actor,
                    assigned_user_id,
                    role_code,
                    user_field,
                )
        result = await connection.execute(
            text(
                f"""
                UPDATE {resource.table} SET {assignments}
                WHERE college_id = :college_id AND id = :record_id
                RETURNING id, college_id, {selected_columns}
                """
            ),
            {"college_id": actor.college_id, "record_id": record_id, **values},
        )
        row = result.mappings().one_or_none()
        if row is None:
            raise _not_found()
        return row

    return await _run_mutation(connection, operation)


async def delete_resource(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    resource_name: str,
    record_id: UUID,
) -> None:
    resource = _resource(resource_name)

    async def operation() -> None:
        if resource.soft_delete:
            statement = text(
                f"""
                UPDATE {resource.table} SET is_active = FALSE
                WHERE college_id = :college_id AND id = :record_id
                RETURNING id
                """
            )
        else:
            statement = text(
                f"""
                DELETE FROM {resource.table}
                WHERE college_id = :college_id AND id = :record_id
                RETURNING id
                """
            )
        result = await connection.execute(
            statement,
            {"college_id": actor.college_id, "record_id": record_id},
        )
        if result.scalar_one_or_none() is None:
            raise _not_found()

    await _run_mutation(connection, operation)


async def list_profiles(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    profile_type: str,
    *,
    limit: int,
    offset: int,
) -> list[Mapping[str, Any]]:
    query = _PROFILE_SELECTS[profile_type]
    result = await connection.execute(
        text(f"{query} ORDER BY u.created_at DESC, u.id LIMIT :limit OFFSET :offset"),
        {"college_id": actor.college_id, "limit": limit, "offset": offset},
    )
    return list(result.mappings().all())


async def get_profile(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    profile_type: str,
    user_id: UUID,
) -> Mapping[str, Any]:
    query = _PROFILE_SELECTS[profile_type]
    result = await connection.execute(
        text(f"{query} AND u.id = :user_id"),
        {"college_id": actor.college_id, "user_id": user_id},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise _not_found()
    return row


async def create_profile(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    profile_type: str,
    payload: FacultyCreate | StudentCreate,
) -> Mapping[str, Any]:
    values = payload.model_dump()
    password = values.pop("password")
    if isinstance(password, SecretStr):
        password = password.get_secret_value()
    values["password_hash"] = hash_password(password)
    if profile_type == "faculty":
        role_code = "FACULTY"
        profile_columns = ("employee_id", "department_id", "designation")
        profile_table = "faculty_profiles"
    else:
        role_code = "STUDENT"
        profile_columns = ("roll_number", "registration_number")
        profile_table = "student_profiles"
    profile_values = {column: values[column] for column in profile_columns}

    async def operation() -> Mapping[str, Any]:
        user_result = await connection.execute(
            text(
                """
                INSERT INTO users
                    (college_id, email, password_hash, first_name, last_name)
                VALUES
                    (:college_id, :email, :password_hash, :first_name, :last_name)
                RETURNING id
                """
            ),
            {
                "college_id": actor.college_id,
                "email": values["email"],
                "password_hash": values["password_hash"],
                "first_name": values["first_name"],
                "last_name": values["last_name"],
            },
        )
        user_id = user_result.scalar_one()
        await connection.execute(
            text(
                """
                INSERT INTO user_roles (college_id, user_id, role_code)
                VALUES (:college_id, :user_id, :role_code)
                """
            ),
            {
                "college_id": actor.college_id,
                "user_id": user_id,
                "role_code": role_code,
            },
        )
        profile_names = ("user_id", "college_id", *profile_values.keys())
        profile_columns_sql = ", ".join(profile_names)
        profile_values_sql = ", ".join(f":{column}" for column in profile_names)
        await connection.execute(
            text(
                f"""
                INSERT INTO {profile_table} ({profile_columns_sql})
                VALUES ({profile_values_sql})
                """
            ),
            {"user_id": user_id, "college_id": actor.college_id, **profile_values},
        )
        return await get_profile(connection, actor, profile_type, user_id)

    return await _run_mutation(connection, operation)


async def update_profile(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    profile_type: str,
    user_id: UUID,
    values: Mapping[str, object],
) -> Mapping[str, Any]:
    user_fields = {"email", "first_name", "last_name"}
    profile_fields = (
        {"employee_id", "department_id", "designation"}
        if profile_type == "faculty"
        else {"roll_number", "registration_number"}
    )
    user_values = {key: value for key, value in values.items() if key in user_fields}
    profile_values = {key: value for key, value in values.items() if key in profile_fields}
    if not user_values and not profile_values:
        raise HTTPException(status_code=422, detail="Invalid fields for this profile")
    profile_table = "faculty_profiles" if profile_type == "faculty" else "student_profiles"
    user_role = profile_type.upper()

    async def operation() -> Mapping[str, Any]:
        if user_values:
            user_assignments = ", ".join(f"{field} = :{field}" for field in user_values)
            user_result = await connection.execute(
                text(
                    f"""
                    UPDATE users SET {user_assignments}
                    WHERE id = :user_id AND college_id = :college_id
                      AND EXISTS (
                          SELECT 1 FROM user_roles
                          WHERE user_id = users.id AND college_id = users.college_id
                            AND role_code = :role_code
                      )
                      AND EXISTS (
                          SELECT 1 FROM {profile_table}
                          WHERE user_id = users.id AND college_id = users.college_id
                      )
                    RETURNING id
                    """
                ),
                {
                    **user_values,
                    "user_id": user_id,
                    "college_id": actor.college_id,
                    "role_code": user_role,
                },
            )
            if user_result.scalar_one_or_none() is None:
                raise _not_found()
        if profile_values:
            assignments = ", ".join(f"{field} = :{field}" for field in profile_values)
            profile_result = await connection.execute(
                text(
                    f"""
                    UPDATE {profile_table} SET {assignments}
                    WHERE user_id = :user_id AND college_id = :college_id
                    RETURNING user_id
                    """
                ),
                {**profile_values, "user_id": user_id, "college_id": actor.college_id},
            )
            if profile_result.scalar_one_or_none() is None:
                raise _not_found()
        return await get_profile(connection, actor, profile_type, user_id)

    return await _run_mutation(connection, operation)


async def deactivate_profile(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    profile_type: str,
    user_id: UUID,
) -> None:
    profile_table = "faculty_profiles" if profile_type == "faculty" else "student_profiles"
    role_code = profile_type.upper()

    async def operation() -> None:
        result = await connection.execute(
            text(
                f"""
                UPDATE users
                SET is_active = FALSE, token_version = token_version + 1
                WHERE id = :user_id AND college_id = :college_id
                  AND EXISTS (
                      SELECT 1 FROM {profile_table}
                      WHERE user_id = users.id AND college_id = users.college_id
                  )
                  AND EXISTS (
                      SELECT 1 FROM user_roles
                      WHERE user_id = users.id AND college_id = users.college_id
                        AND role_code = :role_code
                  )
                RETURNING id
                """
            ),
            {
                "user_id": user_id,
                "college_id": actor.college_id,
                "role_code": role_code,
            },
        )
        if result.scalar_one_or_none() is None:
            raise _not_found()
        if profile_type == "faculty":
            await connection.execute(
                text(
                    """
                    UPDATE faculty_assignments
                    SET is_active = FALSE
                    WHERE college_id = :college_id AND faculty_user_id = :user_id
                    """
                ),
                {"college_id": actor.college_id, "user_id": user_id},
            )
        else:
            await connection.execute(
                text(
                    """
                    UPDATE student_enrollments
                    SET is_active = FALSE
                    WHERE college_id = :college_id AND student_user_id = :user_id
                    """
                ),
                {"college_id": actor.college_id, "user_id": user_id},
            )

    await _run_mutation(connection, operation)


def patch_values(payload: BaseModel) -> dict[str, object]:
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(status_code=422, detail="At least one field must be provided")
    return values
