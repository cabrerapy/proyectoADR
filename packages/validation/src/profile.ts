import type { ValidationIssue, ValidationResult } from "./index";

export interface CompleteProfileInput {
  readonly displayName: string;
  readonly expectedVersion: number;
  readonly phone: string;
}

export interface UpdateOwnProfileInput {
  readonly displayName: string;
  readonly emailNotificationsEnabled: boolean;
  readonly expectedVersion: number;
  readonly phone: string;
}

const issue = (path: string, message: string): ValidationIssue => ({
  code: "INVALID_PROFILE_FIELD",
  message,
  path: [path],
});

const normalizeName = (value: string): string =>
  value.trim().normalize("NFKC").replace(/\s+/gu, " ");

const normalizePhone = (value: string): string => {
  const compact = value.normalize("NFKC").replace(/[\s().-]/gu, "");
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("595")) return `+${compact}`;
  if (compact.startsWith("0")) return `+595${compact.slice(1)}`;
  return compact;
};

export const validateCompleteProfile = (
  value: unknown,
): ValidationResult<CompleteProfileInput> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { success: false, issues: [issue("$", "El contenido debe ser un objeto.")] };
  }

  const record = value as Record<string, unknown>;
  const allowed = new Set(["displayName", "expectedVersion", "phone"]);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  const issues: ValidationIssue[] = unexpected.length > 0
    ? [issue("$", "El contenido incluye campos no permitidos.")]
    : [];
  const displayName = typeof record.displayName === "string"
    ? normalizeName(record.displayName)
    : "";
  const phone = typeof record.phone === "string" ? normalizePhone(record.phone) : "";

  if (displayName.length < 3 || displayName.length > 100 || /[\p{Cc}\p{Cf}]/u.test(displayName)) {
    issues.push(issue("displayName", "El nombre debe tener entre 3 y 100 caracteres."));
  }
  if (!/^\+[1-9]\d{7,14}$/u.test(phone)) {
    issues.push(issue("phone", "Ingresa un teléfono válido, por ejemplo +595981123456."));
  }
  if (
    typeof record.expectedVersion !== "number" ||
    !Number.isSafeInteger(record.expectedVersion) ||
    record.expectedVersion < 1
  ) {
    issues.push(issue("expectedVersion", "La versión del perfil no es válida."));
  }

  if (issues.length > 0) {
    const [first, ...remaining] = issues;
    if (first !== undefined) {
      return { success: false, issues: [first, ...remaining] };
    }
  }
  return {
    success: true,
    data: {
      displayName,
      expectedVersion: record.expectedVersion as number,
      phone,
    },
  };
};

export const validateUpdateOwnProfile = (
  value: unknown,
): ValidationResult<UpdateOwnProfileInput> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { success: false, issues: [issue("$", "El contenido debe ser un objeto.")] };
  }

  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "displayName",
    "emailNotificationsEnabled",
    "expectedVersion",
    "phone",
  ]);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  const issues: ValidationIssue[] = unexpected.length > 0
    ? [issue("$", "El contenido incluye campos no permitidos.")]
    : [];
  const displayName = typeof record.displayName === "string"
    ? normalizeName(record.displayName)
    : "";
  const phone = typeof record.phone === "string" ? normalizePhone(record.phone) : "";

  if (displayName.length < 3 || displayName.length > 100 || /[\p{Cc}\p{Cf}]/u.test(displayName)) {
    issues.push(issue("displayName", "El nombre debe tener entre 3 y 100 caracteres."));
  }
  if (!/^\+[1-9]\d{7,14}$/u.test(phone)) {
    issues.push(issue("phone", "Ingresa un teléfono válido, por ejemplo +595981123456."));
  }
  if (typeof record.emailNotificationsEnabled !== "boolean") {
    issues.push(issue("emailNotificationsEnabled", "La preferencia de correo no es válida."));
  }
  if (
    typeof record.expectedVersion !== "number" ||
    !Number.isSafeInteger(record.expectedVersion) ||
    record.expectedVersion < 1
  ) {
    issues.push(issue("expectedVersion", "La versión del perfil no es válida."));
  }

  if (issues.length > 0) {
    const [first, ...remaining] = issues;
    if (first !== undefined) return { success: false, issues: [first, ...remaining] };
  }
  return {
    success: true,
    data: {
      displayName,
      emailNotificationsEnabled: record.emailNotificationsEnabled as boolean,
      expectedVersion: record.expectedVersion as number,
      phone,
    },
  };
};
