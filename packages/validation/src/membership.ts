import type { ValidationIssue, ValidationResult } from "./index";

const STATUSES = ["PENDING", "ACTIVE", "EXPIRED", "SUSPENDED", "CANCELLED"] as const;
export type MembershipStatusInput = (typeof STATUSES)[number];

export interface CreateMembershipCommand {
  readonly endDate: string;
  readonly expectedAmount: number;
  readonly planId: string;
  readonly startDate: string;
  readonly userId: string;
}

export interface UpdateMembershipCommand {
  readonly endDate: string;
  readonly expectedAmount: number;
  readonly expectedVersion: number;
  readonly reason?: string;
  readonly startDate: string;
  readonly status: MembershipStatusInput;
  readonly userId: string;
}

export interface MembershipHistoryQuery {
  readonly userId: string;
}

export interface OwnMembershipQuery {
  readonly cursor?: string;
}

export interface MembershipReportQuery {
  readonly cursor?: string;
  readonly filter: "due" | "status";
  readonly value: MembershipStatusInput | string;
}

const issue = (path: string, message: string): ValidationIssue => ({
  code: "INVALID_MEMBERSHIP_FIELD",
  message,
  path: [path],
});

const finish = <T>(issues: ValidationIssue[], data: T): ValidationResult<T> => {
  const [first, ...rest] = issues;
  return first === undefined ? { data, success: true } : { issues: [first, ...rest], success: false };
};

const id = (value: unknown): string | undefined =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value) ? value : undefined;

const date = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : undefined;
};

const amount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

const normalizedReason = (value: unknown): string | undefined =>
  typeof value === "string" ? value.trim().normalize("NFKC").replace(/\s+/gu, " ") : undefined;

const cursor = (value: string | null): string | undefined =>
  value !== null && value.length >= 1 && value.length <= 8_192 && /^[A-Za-z0-9_-]+$/u.test(value)
    ? value
    : undefined;

export const validateOwnMembershipQuery = (
  params: URLSearchParams,
): ValidationResult<OwnMembershipQuery> => {
  const issues: ValidationIssue[] = [...params.keys()].some((key) => key !== "cursor")
    ? [issue("$", "La consulta incluye parámetros no permitidos.")]
    : [];
  const rawCursor = params.get("cursor");
  const parsedCursor = cursor(rawCursor);
  if (rawCursor !== null && parsedCursor === undefined) issues.push(issue("cursor", "El cursor no es válido."));
  return finish(issues, parsedCursor === undefined ? {} : { cursor: parsedCursor });
};

export const validateMembershipReportQuery = (
  params: URLSearchParams,
): ValidationResult<MembershipReportQuery> => {
  const issues: ValidationIssue[] = [...params.keys()].some(
    (key) => key !== "cursor" && key !== "filter" && key !== "value",
  ) ? [issue("$", "La consulta incluye parámetros no permitidos.")] : [];
  const filter = params.get("filter");
  const value = params.get("value") ?? "";
  if (filter !== "due" && filter !== "status") issues.push(issue("filter", "Selecciona un reporte válido."));
  if (filter === "due" && date(value) === undefined) issues.push(issue("value", "La fecha de vencimiento no es válida."));
  if (filter === "status" && !STATUSES.some((candidate) => candidate === value)) {
    issues.push(issue("value", "El estado de membresía no es válido."));
  }
  const rawCursor = params.get("cursor");
  const parsedCursor = cursor(rawCursor);
  if (rawCursor !== null && parsedCursor === undefined) issues.push(issue("cursor", "El cursor no es válido."));
  return finish(issues, {
    ...(parsedCursor === undefined ? {} : { cursor: parsedCursor }),
    filter: filter === "status" ? "status" : "due",
    value,
  });
};

export const validateMembershipHistoryQuery = (
  params: URLSearchParams,
): ValidationResult<MembershipHistoryQuery> => {
  const issues: ValidationIssue[] = [...params.keys()].some((key) => key !== "userId")
    ? [issue("$", "La consulta incluye parámetros no permitidos.")]
    : [];
  const userId = id(params.get("userId"));
  if (userId === undefined) issues.push(issue("userId", "El alumno no es válido."));
  return finish(issues, { userId: userId ?? "" });
};

const validateBase = (
  value: unknown,
  update: boolean,
): ValidationResult<CreateMembershipCommand | UpdateMembershipCommand> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { issues: [issue("$", "El contenido debe ser un objeto.")], success: false };
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["endDate", "expectedAmount", "planId", "startDate", "userId"]);
  if (update) {
    allowed.delete("planId");
    for (const key of ["expectedVersion", "reason", "status"]) allowed.add(key);
  }
  const issues: ValidationIssue[] = Object.keys(record).some((key) => !allowed.has(key))
    ? [issue("$", "El contenido incluye campos no permitidos.")]
    : [];
  const userId = id(record.userId);
  const planId = update ? undefined : id(record.planId);
  const startDate = date(record.startDate);
  const endDate = date(record.endDate);
  const expectedAmount = amount(record.expectedAmount);
  if (userId === undefined) issues.push(issue("userId", "El alumno no es válido."));
  if (!update && planId === undefined) issues.push(issue("planId", "Selecciona un plan válido."));
  if (startDate === undefined) issues.push(issue("startDate", "La fecha de inicio no es válida."));
  if (endDate === undefined) issues.push(issue("endDate", "La fecha de vencimiento no es válida."));
  if (startDate !== undefined && endDate !== undefined && endDate < startDate) {
    issues.push(issue("endDate", "El vencimiento no puede ser anterior al inicio."));
  }
  if (expectedAmount === undefined) issues.push(issue("expectedAmount", "El importe debe ser un entero positivo en PYG."));
  const base: CreateMembershipCommand = {
    endDate: endDate ?? "",
    expectedAmount: expectedAmount ?? 0,
    planId: planId ?? "",
    startDate: startDate ?? "",
    userId: userId ?? "",
  };
  if (!update) return finish(issues, base);
  const status = typeof record.status === "string" && STATUSES.some((candidate) => candidate === record.status)
    ? record.status as MembershipStatusInput
    : undefined;
  const expectedVersion = typeof record.expectedVersion === "number" && Number.isSafeInteger(record.expectedVersion) && record.expectedVersion > 0
    ? record.expectedVersion
    : undefined;
  const reason = normalizedReason(record.reason);
  if (status === undefined) issues.push(issue("status", "El estado no es válido."));
  if (expectedVersion === undefined) issues.push(issue("expectedVersion", "La versión no es válida."));
  if (reason !== undefined && (reason.length < 5 || reason.length > 500)) {
    issues.push(issue("reason", "El motivo debe tener entre 5 y 500 caracteres."));
  }
  return finish(issues, {
    endDate: base.endDate,
    expectedAmount: base.expectedAmount,
    expectedVersion: expectedVersion ?? 0,
    ...(reason === undefined || reason === "" ? {} : { reason }),
    startDate: base.startDate,
    status: status ?? "PENDING",
    userId: base.userId,
  });
};

export const validateCreateMembership = (value: unknown): ValidationResult<CreateMembershipCommand> =>
  validateBase(value, false) as ValidationResult<CreateMembershipCommand>;

export const validateUpdateMembership = (value: unknown): ValidationResult<UpdateMembershipCommand> =>
  validateBase(value, true) as ValidationResult<UpdateMembershipCommand>;
