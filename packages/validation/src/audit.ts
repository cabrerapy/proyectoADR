import type { ValidationResult } from "./index";

export type AuditQuery =
  | { readonly cursor?: string; readonly from: string; readonly mode: "ACTOR"; readonly actorId: string; readonly to: string }
  | { readonly cursor?: string; readonly from: string; readonly mode: "ENTITY"; readonly targetId: string; readonly targetType: string; readonly to: string };

const failure = (path: string, message: string): ValidationResult<never> => ({ success: false, issues: [{ code: "INVALID", message, path: [path] }] });
const id = (value: string | null): string | undefined => value !== null && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value) ? value : undefined;
const timestamp = (value: string | null): string | undefined => value !== null && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;

export const validateAuditQuery = (params: URLSearchParams): ValidationResult<AuditQuery> => {
  const allowed = new Set(["actorId", "cursor", "from", "mode", "targetId", "targetType", "to"]);
  if ([...params.keys()].some((key) => !allowed.has(key))) return failure("$", "La consulta contiene parámetros no permitidos.");
  const mode = params.get("mode"); const from = timestamp(params.get("from")); const to = timestamp(params.get("to")); const cursor = params.get("cursor") ?? undefined;
  if ((mode !== "ACTOR" && mode !== "ENTITY") || from === undefined || to === undefined || from > to || (cursor !== undefined && cursor.length > 4096)) return failure("$", "El rango o modo de auditoría no es válido.");
  if (mode === "ACTOR") { const actorId = id(params.get("actorId")); if (actorId === undefined || params.has("targetId") || params.has("targetType")) return failure("actorId", "El actor no es válido."); return { success: true, data: { actorId, ...(cursor === undefined ? {} : { cursor }), from, mode, to } }; }
  const targetId = id(params.get("targetId")); const targetType = id(params.get("targetType"));
  if (targetId === undefined || targetType === undefined || params.has("actorId")) return failure("targetId", "La entidad no es válida.");
  return { success: true, data: { ...(cursor === undefined ? {} : { cursor }), from, mode, targetId, targetType, to } };
};
