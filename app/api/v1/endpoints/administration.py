from collections.abc import Mapping
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncConnection

from app.api.deps import get_current_actor, get_database_connection, require_roles
from app.schemas.administration import (
    AcademicYearCreate,
    AcademicYearUpdate,
    BranchCreate,
    BranchUpdate,
    ClassCreate,
    ClassUpdate,
    CollegeUpdate,
    DepartmentCreate,
    DepartmentUpdate,
    EnrollmentCreate,
    EnrollmentUpdate,
    FacultyAssignmentCreate,
    FacultyAssignmentUpdate,
    FacultyCreate,
    FacultyUpdate,
    StudentCreate,
    StudentUpdate,
    SubjectCreate,
    SubjectUpdate,
)
from app.schemas.auth import AuthenticatedUser
from app.services import administration_service

router = APIRouter(
    prefix="/admin",
    tags=["institutional administration"],
    dependencies=[Depends(require_roles("ADMIN"))],
)
DatabaseConnection = Annotated[AsyncConnection, Depends(get_database_connection)]
Actor = Annotated[AuthenticatedUser, Depends(get_current_actor)]
ResourceName = Literal[
    "academic-years",
    "departments",
    "branches",
    "classes",
    "subjects",
    "faculty-assignments",
    "enrollments",
]
CreateResourceRequest = (
    AcademicYearCreate
    | DepartmentCreate
    | BranchCreate
    | ClassCreate
    | SubjectCreate
    | FacultyAssignmentCreate
    | EnrollmentCreate
)
UpdateResourceRequest = (
    AcademicYearUpdate
    | DepartmentUpdate
    | BranchUpdate
    | ClassUpdate
    | SubjectUpdate
    | FacultyAssignmentUpdate
    | EnrollmentUpdate
)


def _academic_resource_name(resource_name: ResourceName) -> str:
    return "student_enrollments" if resource_name == "enrollments" else resource_name.replace("-", "_")


@router.get("/college", response_model=dict[str, object])
async def read_own_college(
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await administration_service.get_college(connection, actor)


@router.patch("/college", response_model=dict[str, object])
async def update_own_college(
    request: CollegeUpdate,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await administration_service.update_college(
        connection,
        actor,
        request.model_dump(exclude_unset=True),
    )


@router.get("/academic/{resource_name}", response_model=list[dict[str, object]])
async def list_academic_records(
    resource_name: ResourceName,
    connection: DatabaseConnection,
    actor: Actor,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Mapping[str, Any]]:
    return await administration_service.list_resources(
        connection,
        actor,
        _academic_resource_name(resource_name),
        limit=limit,
        offset=offset,
    )


@router.post(
    "/academic/{resource_name}",
    response_model=dict[str, object],
    status_code=status.HTTP_201_CREATED,
)
async def create_academic_record(
    resource_name: ResourceName,
    request: CreateResourceRequest,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await administration_service.create_resource(
        connection,
        actor,
        _academic_resource_name(resource_name),
        request.model_dump(exclude_unset=True),
    )


@router.get("/academic/{resource_name}/{record_id}", response_model=dict[str, object])
async def read_academic_record(
    resource_name: ResourceName,
    record_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await administration_service.get_resource(
        connection,
        actor,
        _academic_resource_name(resource_name),
        record_id,
    )


@router.patch("/academic/{resource_name}/{record_id}", response_model=dict[str, object])
async def update_academic_record(
    resource_name: ResourceName,
    record_id: UUID,
    request: UpdateResourceRequest,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await administration_service.update_resource(
        connection,
        actor,
        _academic_resource_name(resource_name),
        record_id,
        administration_service.patch_values(request),
    )


@router.delete(
    "/academic/{resource_name}/{record_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_academic_record(
    resource_name: ResourceName,
    record_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Response:
    await administration_service.delete_resource(
        connection,
        actor,
        _academic_resource_name(resource_name),
        record_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/faculty", response_model=list[dict[str, object]])
async def list_faculty(
    connection: DatabaseConnection,
    actor: Actor,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Mapping[str, Any]]:
    return await administration_service.list_profiles(
        connection, actor, "faculty", limit=limit, offset=offset
    )


@router.post("/faculty", response_model=dict[str, object], status_code=status.HTTP_201_CREATED)
async def create_faculty(
    request: FacultyCreate,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await administration_service.create_profile(connection, actor, "faculty", request)


@router.get("/faculty/{user_id}", response_model=dict[str, object])
async def read_faculty(
    user_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await administration_service.get_profile(connection, actor, "faculty", user_id)


@router.patch("/faculty/{user_id}", response_model=dict[str, object])
async def update_faculty(
    user_id: UUID,
    request: FacultyUpdate,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await administration_service.update_profile(
        connection,
        actor,
        "faculty",
        user_id,
        administration_service.patch_values(request),
    )


@router.delete("/faculty/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_faculty(
    user_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Response:
    await administration_service.deactivate_profile(connection, actor, "faculty", user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/students", response_model=list[dict[str, object]])
async def list_students(
    connection: DatabaseConnection,
    actor: Actor,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Mapping[str, Any]]:
    return await administration_service.list_profiles(
        connection, actor, "student", limit=limit, offset=offset
    )


@router.post("/students", response_model=dict[str, object], status_code=status.HTTP_201_CREATED)
async def create_student(
    request: StudentCreate,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await administration_service.create_profile(connection, actor, "student", request)


@router.get("/students/{user_id}", response_model=dict[str, object])
async def read_student(
    user_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await administration_service.get_profile(connection, actor, "student", user_id)


@router.patch("/students/{user_id}", response_model=dict[str, object])
async def update_student(
    user_id: UUID,
    request: StudentUpdate,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await administration_service.update_profile(
        connection,
        actor,
        "student",
        user_id,
        administration_service.patch_values(request),
    )


@router.delete("/students/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_student(
    user_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Response:
    await administration_service.deactivate_profile(connection, actor, "student", user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
