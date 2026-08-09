import type { ValidationIssue, ValidationResult } from "./index";

const FREQUENCIES = ["MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"] as const;
const STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type MembershipPlanFrequency = (typeof FREQUENCIES)[number];
export type MembershipPlanStatusInput = (typeof STATUSES)[number];

export interface MembershipPlanCommand {
  readonly currency: "PYG";
  readonly description?: string;
  readonly frequency: MembershipPlanFrequency;
  readonly name: string;
  readonly price: number;
}

export interface UpdateMembershipPlanCommand extends MembershipPlanCommand {
  readonly expectedVersion: number;
  readonly status: MembershipPlanStatusInput;
}

export interface MembershipPlanQuery {
  readonly cursor?: string;
  readonly status: MembershipPlanStatusInput | "ALL";
}

const issue = (path: string, message: string): ValidationIssue => ({
  code: "INVALID_MEMBERSHIP_PLAN_FIELD",
  message,
  path: [path],
});

const result = <T>(issues: ValidationIssue[], data: T): ValidationResult<T> => {
  const [first, ...remaining] = issues;
  return first === undefined ? { data, success: true } : { issues: [first, ...remaining], success: false };
};

const normalizeText = (value: unknown): string | undefined => typeof value === "string"
  ? value.trim().normalize("NFKC").replace(/\s+/gu, " ")
  : undefined;

const validateBase = (value: unknown, update: boolean): ValidationResult<UpdateMembershipPlanCommand | MembershipPlanCommand> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { issues: [issue("$", "El contenido debe ser un objeto.")], success: false };
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "currency", "description", "expectedVersion", "frequency", "name", "price", "status",
  ].filter((key) => update || (key !== "expectedVersion" && key !== "status")));
  const issues: ValidationIssue[] = Object.keys(record).some((key) => !allowed.has(key))
    ? [issue("$", "El contenido incluye campos no permitidos.")]
    : [];
  const name = normalizeText(record.name);
  const description = normalizeText(record.description);
  const frequency = typeof record.frequency === "string" && FREQUENCIES.some((entry) => entry === record.frequency)
    ? record.frequency as MembershipPlanFrequency
    : undefined;
  const status = typeof record.status === "string" && STATUSES.some((entry) => entry === record.status)
    ? record.status as MembershipPlanStatusInput
    : undefined;
  if (name === undefined || name.length < 2 || name.length > 120 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    issues.push(issue("name", "El nombre debe tener entre 2 y 120 caracteres."));
  }
  if (description !== undefined && (description.length < 1 || description.length > 500 || /[\p{Cc}\p{Cf}]/u.test(description))) {
    issues.push(issue("description", "La descripción admite hasta 500 caracteres."));
  }
  if (record.currency !== "PYG") issues.push(issue("currency", "La moneda del MVP debe ser PYG."));
  if (frequency === undefined) issues.push(issue("frequency", "Selecciona una frecuencia válida."));
  if (typeof record.price !== "number" || !Number.isSafeInteger(record.price) || record.price < 1) {
    issues.push(issue("price", "El precio debe ser un entero positivo en PYG."));
  }
  if (update && status === undefined) issues.push(issue("status", "Selecciona un estado válido."));
  if (update && (typeof record.expectedVersion !== "number" || !Number.isSafeInteger(record.expectedVersion) || record.expectedVersion < 1)) {
    issues.push(issue("expectedVersion", "La versión del plan no es válida."));
  }
  const base: MembershipPlanCommand = {
    currency: "PYG",
    ...(description === undefined || description === "" ? {} : { description }),
    frequency: frequency as MembershipPlanFrequency,
    name: name as string,
    price: record.price as number,
  };
  return result(issues, update
    ? { ...base, expectedVersion: record.expectedVersion as number, status: status as MembershipPlanStatusInput }
    : base);
};

export const validateCreateMembershipPlan = (value: unknown): ValidationResult<MembershipPlanCommand> =>
  validateBase(value, false) as ValidationResult<MembershipPlanCommand>;

export const validateUpdateMembershipPlan = (value: unknown): ValidationResult<UpdateMembershipPlanCommand> =>
  validateBase(value, true) as ValidationResult<UpdateMembershipPlanCommand>;

export const validateMembershipPlanQuery = (params: URLSearchParams): ValidationResult<MembershipPlanQuery> => {
  const issues: ValidationIssue[] = [...params.keys()].some((key) => key !== "cursor" && key !== "status")
    ? [issue("$", "La consulta incluye parámetros no permitidos.")]
    : [];
  const rawStatus = params.get("status") ?? "ALL";
  const status = rawStatus === "ALL" || STATUSES.some((entry) => entry === rawStatus)
    ? rawStatus as MembershipPlanStatusInput | "ALL"
    : "ALL";
  if (status !== rawStatus) issues.push(issue("status", "El estado consultado no es válido."));
  const cursor = params.get("cursor") ?? undefined;
  if (cursor !== undefined && (cursor.length < 1 || cursor.length > 8_192 || !/^[A-Za-z0-9_-]+$/u.test(cursor))) {
    issues.push(issue("cursor", "El cursor no es válido."));
  }
  return result(issues, { ...(cursor === undefined ? {} : { cursor }), status });
};
