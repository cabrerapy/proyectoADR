import type { ValidationIssue, ValidationResult } from "./index";

export interface ClassSessionCommand {
  readonly capacity: number;
  readonly classTypeId: string;
  readonly endsAt: string;
  readonly startsAt: string;
  readonly trainerId: string;
}
export interface UpdateClassSessionCommand extends ClassSessionCommand { readonly expectedVersion: number }
export interface ClassSessionQuery { readonly date: string }
export interface CancelClassSessionCommand { readonly cursor?: string; readonly expectedVersion: number; readonly reason: string }

const issue = (path: string, message: string): ValidationIssue => ({ code: "INVALID_CLASS_SESSION_FIELD", message, path: [path] });
const id = (value: unknown): string | undefined => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value) ? value : undefined;
const timestamp = (value: unknown): string | undefined => { if (typeof value !== "string") return undefined; const parsed = new Date(value); return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value ? value : undefined; };
const date = (value: unknown): string | undefined => { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined; const parsed = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : undefined; };
const result = <T>(issues: ValidationIssue[], data: T): ValidationResult<T> => { const [first, ...rest] = issues; return first === undefined ? { data, success: true } : { issues: [first, ...rest], success: false }; };

const validate = (value: unknown, update: boolean): ValidationResult<ClassSessionCommand | UpdateClassSessionCommand> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { issues: [issue("$", "El contenido debe ser un objeto.")], success: false };
  const record = value as Record<string, unknown>;
  const allowed = new Set(update ? ["capacity", "classTypeId", "endsAt", "expectedVersion", "startsAt", "trainerId"] : ["capacity", "classTypeId", "endsAt", "startsAt", "trainerId"]);
  const issues: ValidationIssue[] = Object.keys(record).some((key) => !allowed.has(key)) ? [issue("$", "El contenido incluye campos no permitidos.")] : [];
  const capacity = typeof record.capacity === "number" && Number.isSafeInteger(record.capacity) && record.capacity >= 1 && record.capacity <= 500 ? record.capacity : undefined;
  const classTypeId = id(record.classTypeId); const trainerId = id(record.trainerId); const startsAt = timestamp(record.startsAt); const endsAt = timestamp(record.endsAt);
  if (capacity === undefined) issues.push(issue("capacity", "La capacidad debe estar entre 1 y 500."));
  if (classTypeId === undefined) issues.push(issue("classTypeId", "El tipo de clase no es válido."));
  if (trainerId === undefined) issues.push(issue("trainerId", "El entrenador no es válido."));
  if (startsAt === undefined || endsAt === undefined || (startsAt !== undefined && endsAt !== undefined && endsAt <= startsAt)) issues.push(issue("endsAt", "El horario no es válido."));
  const base = { capacity: capacity ?? 0, classTypeId: classTypeId ?? "", endsAt: endsAt ?? "", startsAt: startsAt ?? "", trainerId: trainerId ?? "" };
  if (!update) return result(issues, base);
  const expectedVersion = typeof record.expectedVersion === "number" && Number.isSafeInteger(record.expectedVersion) && record.expectedVersion > 0 ? record.expectedVersion : undefined;
  if (expectedVersion === undefined) issues.push(issue("expectedVersion", "La versión no es válida."));
  return result(issues, { ...base, expectedVersion: expectedVersion ?? 0 });
};

export const validateCreateClassSession = (value: unknown): ValidationResult<ClassSessionCommand> => validate(value, false) as ValidationResult<ClassSessionCommand>;
export const validateUpdateClassSession = (value: unknown): ValidationResult<UpdateClassSessionCommand> => validate(value, true) as ValidationResult<UpdateClassSessionCommand>;
export const validateCancelClassSession = (value: unknown): ValidationResult<CancelClassSessionCommand> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { issues: [issue("$", "El contenido debe ser un objeto.")], success: false };
  const record = value as Record<string, unknown>;
  const issues: ValidationIssue[] = Object.keys(record).some((key) => !["cursor", "expectedVersion", "reason"].includes(key)) ? [issue("$", "El contenido incluye campos no permitidos.")] : [];
  const expectedVersion = typeof record.expectedVersion === "number" && Number.isSafeInteger(record.expectedVersion) && record.expectedVersion > 0 ? record.expectedVersion : undefined;
  const reason = typeof record.reason === "string" && record.reason.trim().length >= 8 && record.reason.trim().length <= 500 ? record.reason.trim() : undefined;
  const cursor = record.cursor === undefined ? undefined : typeof record.cursor === "string" && /^[A-Za-z0-9_-]{1,4096}$/u.test(record.cursor) ? record.cursor : undefined;
  if (expectedVersion === undefined) issues.push(issue("expectedVersion", "La versión no es válida."));
  if (reason === undefined) issues.push(issue("reason", "El motivo debe contener entre 8 y 500 caracteres."));
  if (record.cursor !== undefined && cursor === undefined) issues.push(issue("cursor", "El cursor no es válido."));
  return result(issues, { ...(cursor === undefined ? {} : { cursor }), expectedVersion: expectedVersion ?? 0, reason: reason ?? "" });
};
export const validateClassSessionQuery = (params: URLSearchParams): ValidationResult<ClassSessionQuery> => {
  const issues: ValidationIssue[] = [...params.keys()].some((key) => key !== "date") ? [issue("$", "La consulta incluye parámetros no permitidos.")] : [];
  const parsed = date(params.get("date")); if (parsed === undefined) issues.push(issue("date", "La fecha no es válida."));
  return result(issues, { date: parsed ?? "" });
};
