import type { ValidationResult } from "./index";

export interface GymSettingsCommand {
  readonly cancellationWindowMinutes: number;
  readonly currency: "PYG";
  readonly expectedVersion?: number;
  readonly gymName: string;
  readonly timezone: "America/Asuncion";
  readonly whatsappNumber?: string;
}

const issue = (path: string, message: string): ValidationResult<never> => ({
  success: false,
  issues: [{ code: "INVALID", message, path: [path] }],
});

export const validateGymSettingsCommand = (value: unknown): ValidationResult<GymSettingsCommand> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return issue("$", "La configuración no es válida.");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["cancellationWindowMinutes", "currency", "expectedVersion", "gymName", "timezone", "whatsappNumber"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return issue("$", "La configuración contiene campos no permitidos.");
  if (!Number.isSafeInteger(input.cancellationWindowMinutes) || Number(input.cancellationWindowMinutes) < 1 || Number(input.cancellationWindowMinutes) > 10_080) return issue("cancellationWindowMinutes", "El plazo debe estar entre 1 y 10080 minutos.");
  if (input.currency !== "PYG") return issue("currency", "La moneda debe ser PYG.");
  if (typeof input.gymName !== "string" || input.gymName.trim().length < 2 || input.gymName.trim().length > 120) return issue("gymName", "El nombre debe tener entre 2 y 120 caracteres.");
  if (input.timezone !== "America/Asuncion") return issue("timezone", "La zona horaria debe ser America/Asuncion.");
  if (input.expectedVersion !== undefined && (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1)) return issue("expectedVersion", "La versión esperada no es válida.");
  if (input.whatsappNumber !== undefined && (typeof input.whatsappNumber !== "string" || !/^\+[1-9]\d{7,14}$/u.test(input.whatsappNumber.trim()))) return issue("whatsappNumber", "WhatsApp debe usar formato E.164.");
  return { success: true, data: {
    cancellationWindowMinutes: Number(input.cancellationWindowMinutes), currency: "PYG",
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: Number(input.expectedVersion) }),
    gymName: input.gymName.trim(), timezone: "America/Asuncion",
    ...(input.whatsappNumber === undefined ? {} : { whatsappNumber: input.whatsappNumber.trim() }),
  } };
};
