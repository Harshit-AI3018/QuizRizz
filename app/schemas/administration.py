from datetime import date
from typing import Annotated, ClassVar, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from app.schemas.auth import normalize_email_address


class PatchModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nullable_patch_fields: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="after")
    def require_patch_fields(self):
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        if any(
            getattr(self, field) is None and field not in self.nullable_patch_fields
            for field in self.model_fields_set
        ):
            raise ValueError("Patch values cannot be null")
        return self


class CreateModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CollegeUpdate(PatchModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    code: str | None = Field(default=None, min_length=1, max_length=50)

    @field_validator("name", "code")
    @classmethod
    def trim_required_values(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Value cannot be empty")
        return value.strip() if value is not None else value

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        return value.upper() if value is not None else value


class AcademicYearCreate(CreateModel):
    name: Annotated[str, Field(min_length=1, max_length=50)]
    start_date: date
    end_date: date
    is_current: bool = False

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name cannot be empty")
        return value.strip()

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.end_date <= self.start_date:
            raise ValueError("end_date must be after start_date")
        return self


class AcademicYearUpdate(PatchModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    start_date: date | None = None
    end_date: date | None = None
    is_current: bool | None = None

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Name cannot be empty")
        return value.strip() if value is not None else value

    @model_validator(mode="after")
    def validate_patch_values(self):
        dates = self.model_dump(exclude_unset=True)
        if "start_date" in dates and "end_date" in dates and dates["end_date"] <= dates["start_date"]:
            raise ValueError("end_date must be after start_date")
        return self


class DepartmentCreate(CreateModel):
    name: Annotated[str, Field(min_length=1, max_length=150)]
    code: Annotated[str, Field(min_length=1, max_length=50)]

    @field_validator("name", "code")
    @classmethod
    def trim_required_values(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Value cannot be empty")
        return value.strip()

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.upper()


class DepartmentUpdate(PatchModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    code: str | None = Field(default=None, min_length=1, max_length=50)

    @field_validator("name", "code")
    @classmethod
    def trim_required_values(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Value cannot be empty")
        return value.strip() if value is not None else value

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        return value.upper() if value is not None else value


class BranchCreate(DepartmentCreate):
    department_id: UUID


class BranchUpdate(DepartmentUpdate):
    department_id: UUID | None = None


class ClassCreate(CreateModel):
    branch_id: UUID
    academic_year_id: UUID
    year_of_study: int = Field(ge=1, le=6)
    semester: int = Field(ge=1, le=12)
    section: Annotated[str, Field(min_length=1, max_length=20)]

    @field_validator("section")
    @classmethod
    def trim_section(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Section cannot be empty")
        return value.strip()


class ClassUpdate(PatchModel):
    branch_id: UUID | None = None
    academic_year_id: UUID | None = None
    year_of_study: int | None = Field(default=None, ge=1, le=6)
    semester: int | None = Field(default=None, ge=1, le=12)
    section: str | None = Field(default=None, min_length=1, max_length=20)

    @field_validator("section")
    @classmethod
    def trim_section(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Section cannot be empty")
        return value.strip() if value is not None else value


class SubjectCreate(DepartmentCreate):
    department_id: UUID


class SubjectUpdate(DepartmentUpdate):
    department_id: UUID | None = None


class AccountCreate(CreateModel):
    email: str
    password: SecretStr = Field(min_length=12, max_length=128)
    first_name: Annotated[str, Field(min_length=1, max_length=100)]
    last_name: Annotated[str, Field(min_length=1, max_length=100)]

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return normalize_email_address(value)

    @field_validator("first_name", "last_name")
    @classmethod
    def trim_names(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name cannot be empty")
        return value.strip()


class FacultyCreate(AccountCreate):
    employee_id: Annotated[str, Field(min_length=1, max_length=50)]
    department_id: UUID
    designation: str | None = Field(default=None, max_length=100)

    @field_validator("employee_id")
    @classmethod
    def normalize_employee_id(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("Employee ID cannot be empty")
        return normalized


class FacultyUpdate(PatchModel):
    email: str | None = None
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    employee_id: str | None = Field(default=None, min_length=1, max_length=50)
    department_id: UUID | None = None
    designation: str | None = Field(default=None, max_length=100)
    nullable_patch_fields = frozenset({"designation"})

    @field_validator("first_name", "last_name")
    @classmethod
    def trim_names(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Name cannot be empty")
        return value.strip() if value is not None else value

    @field_validator("designation")
    @classmethod
    def trim_designation(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        return normalize_email_address(value) if value is not None else value

    @field_validator("employee_id")
    @classmethod
    def normalize_employee_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("Employee ID cannot be empty")
        return normalized


class StudentCreate(AccountCreate):
    roll_number: Annotated[str, Field(min_length=1, max_length=50)]
    registration_number: str | None = Field(default=None, max_length=50)

    @field_validator("roll_number")
    @classmethod
    def normalize_roll_number(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("Roll number cannot be empty")
        return normalized


class StudentUpdate(PatchModel):
    email: str | None = None
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    roll_number: str | None = Field(default=None, min_length=1, max_length=50)
    registration_number: str | None = Field(default=None, max_length=50)
    nullable_patch_fields = frozenset({"registration_number"})

    @field_validator("first_name", "last_name")
    @classmethod
    def trim_names(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Name cannot be empty")
        return value.strip() if value is not None else value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        return normalize_email_address(value) if value is not None else value

    @field_validator("roll_number")
    @classmethod
    def normalize_roll_number(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("Roll number cannot be empty")
        return normalized


class FacultyAssignmentCreate(CreateModel):
    faculty_user_id: UUID
    subject_id: UUID
    class_id: UUID
    academic_year_id: UUID


class FacultyAssignmentUpdate(PatchModel):
    is_active: bool


class EnrollmentCreate(CreateModel):
    student_user_id: UUID
    class_id: UUID
    academic_year_id: UUID
    enrollment_type: Literal["CORE", "ELECTIVE"] = "CORE"


class EnrollmentUpdate(PatchModel):
    is_active: bool
