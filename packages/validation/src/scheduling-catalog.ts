import type { ValidationIssue, ValidationResult } from "./index";

export interface SchedulingCatalogCommand {
  readonly description?: string;
  readonly name: string;
}
export interface UpdateSchedulingCatalogCommand extends SchedulingCatalogCommand {
  readonly expectedVersion: number;
  readonly status: "ACTIVE" | "INACTIVE";
}
export interface SchedulingCatalogQuery { readonly cursor?: string; readonly status: "ACTIVE" | "ALL" | "INACTIVE" }

const issue = (path: string, message: string): ValidationIssue => ({ code: "INVALID_CATALOG_FIELD", message, path: [path] });
const text = (value: unknown, maximum: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().normalize("NFKC").replace(/\s+/gu, " ");
  return normalized.length > 0 && normalized.length <= maximum ? normalized : undefined;
};
const result = <T>(issues: ValidationIssue[], data: T): ValidationResult<T> => {
  const [first, ...rest] = issues;
  return first === undefined ? { data, success: true } : { issues: [first, ...rest], success: false };
};

const validateBase = (value: unknown, update: boolean): ValidationResult<UpdateSchedulingCatalogCommand | SchedulingCatalogCommand> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { issues: [issue("$", "El contenido debe ser un objeto.")], success: false };
  const record = value as Record<string, unknown>;
  const allowed = new Set(update ? ["description", "expectedVersion", "name", "status"] : ["description", "name"]);
  const issues: ValidationIssue[] = Object.keys(record).some((key) => !allowed.has(key)) ? [issue("$", "El contenido incluye campos no permitidos.")] : [];
  const name = text(record.name, 120);
  const description = record.description === undefined || record.description === "" ? undefined : text(record.description, 500);
  if (name === undefined || name.length < 2) issues.push(issue("name", "El nombre debe tener entre 2 y 120 caracteres."));
  if (record.description !== undefined && record.description !== "" && description === undefined) issues.push(issue("description", "La descripción no es válida."));
  if (!update) return result(issues, { ...(description === undefined ? {} : { description }), name: name ?? "" });
  const expectedVersion = typeof record.expectedVersion === "number" && Number.isSafeInteger(record.expectedVersion) && record.expectedVersion > 0 ? record.expectedVersion : undefined;
  const status = record.status === "ACTIVE" || record.status === "INACTIVE" ? record.status : undefined;
  if (expectedVersion === undefined) issues.push(issue("expectedVersion", "La versión no es válida."));
  if (status === undefined) issues.push(issue("status", "El estado no es válido."));
  return result(issues, { ...(description === undefined ? {} : { description }), expectedVersion: expectedVersion ?? 0, name: name ?? "", status: status ?? "INACTIVE" });
};

export const validateCreateSchedulingCatalog = (value: unknown): ValidationResult<SchedulingCatalogCommand> => validateBase(value, false) as ValidationResult<SchedulingCatalogCommand>;
export const validateUpdateSchedulingCatalog = (value: unknown): ValidationResult<UpdateSchedulingCatalogCommand> => validateBase(value, true) as ValidationResult<UpdateSchedulingCatalogCommand>;
export const validateSchedulingCatalogQuery = (params: URLSearchParams): ValidationResult<SchedulingCatalogQuery> => {
  const issues: ValidationIssue[] = [...params.keys()].some((key) => key !== "cursor" && key !== "status") ? [issue("$", "La consulta incluye parámetros no permitidos.")] : [];
  const rawStatus = params.get("status") ?? "ALL";
  const status = rawStatus === "ACTIVE" || rawStatus === "INACTIVE" || rawStatus === "ALL" ? rawStatus : undefined;
  const rawCursor = params.get("cursor");
  const cursor = rawCursor !== null && rawCursor.length <= 8192 && /^[A-Za-z0-9_-]+$/u.test(rawCursor) ? rawCursor : undefined;
  if (status === undefined) issues.push(issue("status", "El estado no es válido."));
  if (rawCursor !== null && cursor === undefined) issues.push(issue("cursor", "El cursor no es válido."));
  return result(issues, { ...(cursor === undefined ? {} : { cursor }), status: status ?? "ALL" });
};
