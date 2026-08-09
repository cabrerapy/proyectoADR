import type { ValidationIssue, ValidationResult } from "./index";

const USER_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED", "INACTIVE"] as const;
type UserStatus = (typeof USER_STATUSES)[number];

export const ADMIN_STUDENT_FILTERS = ["pending", "status", "email", "name"] as const;
export type AdminStudentFilter = (typeof ADMIN_STUDENT_FILTERS)[number];

export interface AdminStudentQuery {
  readonly cursor?: string;
  readonly filter: AdminStudentFilter;
  readonly value?: string;
}

export interface TransitionStudentStatusInput {
  readonly expectedVersion: number;
  readonly reason?: string;
  readonly status: UserStatus;
}

const issue = (path: string, message: string): ValidationIssue => ({
  code: "INVALID_ADMIN_STUDENT_FIELD",
  message,
  path: [path],
});

const isStatus = (value: string): value is UserStatus =>
  USER_STATUSES.some((status) => status === value);

const result = <T>(issues: ValidationIssue[], data: T): ValidationResult<T> => {
  if (issues.length > 0) {
    const [first, ...remaining] = issues;
    if (first !== undefined) return { success: false, issues: [first, ...remaining] };
  }
  return { success: true, data };
};

export const validateAdminStudentQuery = (
  searchParams: URLSearchParams,
): ValidationResult<AdminStudentQuery> => {
  const allowed = new Set(["cursor", "filter", "value"]);
  const issues: ValidationIssue[] = [...searchParams.keys()].some((key) => !allowed.has(key))
    ? [issue("$", "La consulta incluye parámetros no permitidos.")]
    : [];
  const rawFilter = searchParams.get("filter") ?? "pending";
  const filter = ADMIN_STUDENT_FILTERS.some((entry) => entry === rawFilter)
    ? rawFilter as AdminStudentFilter
    : "pending";
  if (filter !== rawFilter) issues.push(issue("filter", "El filtro no es válido."));

  const rawValue = searchParams.get("value")?.trim().normalize("NFKC");
  const value = rawValue === undefined || rawValue === "" ? undefined : rawValue;
  if (filter === "status" && (value === undefined || !isStatus(value))) {
    issues.push(issue("value", "Selecciona un estado válido."));
  }
  if (filter === "email" && (
    value === undefined || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
  )) issues.push(issue("value", "Ingresa un correo válido."));
  if (filter === "name" && (
    value === undefined || value.length < 3 || value.length > 24 || /[\p{Cc}\p{Cf}]/u.test(value)
  )) issues.push(issue("value", "Ingresa entre 3 y 24 caracteres del nombre."));
  if (filter === "pending" && value !== undefined) {
    issues.push(issue("value", "El filtro de pendientes no acepta un valor."));
  }

  const cursor = searchParams.get("cursor") ?? undefined;
  if (cursor !== undefined && (cursor.length < 1 || cursor.length > 8_192 || !/^[A-Za-z0-9_-]+$/u.test(cursor))) {
    issues.push(issue("cursor", "El cursor no es válido."));
  }
  return result(issues, {
    filter,
    ...(value === undefined ? {} : { value }),
    ...(cursor === undefined ? {} : { cursor }),
  });
};

export const validateTransitionStudentStatus = (
  value: unknown,
): ValidationResult<TransitionStudentStatusInput> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { success: false, issues: [issue("$", "El contenido debe ser un objeto.")] };
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["expectedVersion", "reason", "status"]);
  const issues: ValidationIssue[] = Object.keys(record).some((key) => !allowed.has(key))
    ? [issue("$", "El contenido incluye campos no permitidos.")]
    : [];
  const status = typeof record.status === "string" && isStatus(record.status)
    ? record.status
    : undefined;
  const reason = typeof record.reason === "string"
    ? record.reason.trim().normalize("NFKC").replace(/\s+/gu, " ")
    : undefined;
  if (status === undefined) issues.push(issue("status", "El estado solicitado no es válido."));
  if (
    typeof record.expectedVersion !== "number" ||
    !Number.isSafeInteger(record.expectedVersion) ||
    record.expectedVersion < 1
  ) issues.push(issue("expectedVersion", "La versión del perfil no es válida."));
  if (reason !== undefined && (reason.length < 3 || reason.length > 300 || /[\p{Cc}\p{Cf}]/u.test(reason))) {
    issues.push(issue("reason", "El motivo debe tener entre 3 y 300 caracteres."));
  }
  if (status !== undefined && ["REJECTED", "SUSPENDED", "INACTIVE"].includes(status) && reason === undefined) {
    issues.push(issue("reason", "El motivo es obligatorio para este cambio."));
  }
  return result(issues, {
    expectedVersion: record.expectedVersion as number,
    ...(reason === undefined ? {} : { reason }),
    status: status as UserStatus,
  });
};
