import type { ValidationIssue, ValidationResult } from "./index";

const METHODS = ["CASH", "BANK_TRANSFER", "MANUAL_CARD", "OTHER"] as const;
export type PaymentMethodInput = (typeof METHODS)[number];

export interface RecordPaymentCommand {
  readonly amount: number;
  readonly membershipId: string;
  readonly membershipStartDate: string;
  readonly method: PaymentMethodInput;
  readonly notes?: string;
  readonly paidAt: string;
  readonly periodEnd: string;
  readonly periodStart: string;
  readonly receiptKey?: string;
  readonly status: "CONFIRMED" | "PENDING";
  readonly userId: string;
}

export interface PaymentReceiptUploadCommand {
  readonly contentType: "application/pdf" | "image/jpeg" | "image/png";
  readonly fileName: string;
  readonly size: number;
}

export interface OwnPaymentQuery { readonly cursor?: string }
export interface AdminPaymentQuery {
  readonly cursor?: string;
  readonly filter: "date" | "status";
  readonly value: "CONFIRMED" | "PENDING" | "VOIDED" | string;
}
export interface PaymentReceiptQuery {
  readonly paidAt: string;
  readonly paymentId: string;
}

const issue = (path: string, message: string): ValidationIssue => ({
  code: "INVALID_PAYMENT_FIELD",
  message,
  path: [path],
});
const result = <T>(issues: ValidationIssue[], data: T): ValidationResult<T> => {
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
const timestamp = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
};
const text = (value: unknown, maximum: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().normalize("NFKC").replace(/\s+/gu, " ");
  return normalized.length > 0 && normalized.length <= maximum ? normalized : undefined;
};
const cursor = (value: string | null): string | undefined =>
  value !== null && value.length <= 8_192 && /^[A-Za-z0-9_-]+$/u.test(value) ? value : undefined;

export const validateOwnPaymentQuery = (params: URLSearchParams): ValidationResult<OwnPaymentQuery> => {
  const issues: ValidationIssue[] = [...params.keys()].some((key) => key !== "cursor") ? [issue("$", "La consulta incluye parámetros no permitidos.")] : [];
  const raw = params.get("cursor");
  const parsed = cursor(raw);
  if (raw !== null && parsed === undefined) issues.push(issue("cursor", "El cursor no es válido."));
  return result(issues, parsed === undefined ? {} : { cursor: parsed });
};

export const validateAdminPaymentQuery = (params: URLSearchParams): ValidationResult<AdminPaymentQuery> => {
  const issues: ValidationIssue[] = [...params.keys()].some((key) => !["cursor", "filter", "value"].includes(key)) ? [issue("$", "La consulta incluye parámetros no permitidos.")] : [];
  const filter = params.get("filter");
  const value = params.get("value") ?? "";
  if (filter !== "date" && filter !== "status") issues.push(issue("filter", "Selecciona un filtro válido."));
  if (filter === "date" && date(value) === undefined) issues.push(issue("value", "La fecha no es válida."));
  if (filter === "status" && !["PENDING", "CONFIRMED", "VOIDED"].includes(value)) issues.push(issue("value", "El estado no es válido."));
  const raw = params.get("cursor");
  const parsed = cursor(raw);
  if (raw !== null && parsed === undefined) issues.push(issue("cursor", "El cursor no es válido."));
  return result(issues, { ...(parsed === undefined ? {} : { cursor: parsed }), filter: filter === "status" ? "status" : "date", value });
};

export const validatePaymentReceiptQuery = (params: URLSearchParams): ValidationResult<PaymentReceiptQuery> => {
  const issues: ValidationIssue[] = [...params.keys()].some((key) => key !== "paidAt" && key !== "paymentId") ? [issue("$", "La consulta incluye parámetros no permitidos.")] : [];
  const paidAt = timestamp(params.get("paidAt"));
  const paymentId = id(params.get("paymentId"));
  if (paidAt === undefined) issues.push(issue("paidAt", "La fecha del pago no es válida."));
  if (paymentId === undefined) issues.push(issue("paymentId", "El pago no es válido."));
  return result(issues, { paidAt: paidAt ?? "", paymentId: paymentId ?? "" });
};

export const validateRecordPayment = (value: unknown): ValidationResult<RecordPaymentCommand> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { issues: [issue("$", "El contenido debe ser un objeto.")], success: false };
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["amount", "membershipId", "membershipStartDate", "method", "notes", "paidAt", "periodEnd", "periodStart", "receiptKey", "status", "userId"]);
  const issues: ValidationIssue[] = Object.keys(record).some((key) => !allowed.has(key))
    ? [issue("$", "El contenido incluye campos no permitidos.")]
    : [];
  const userId = id(record.userId);
  const membershipId = id(record.membershipId);
  const membershipStartDate = date(record.membershipStartDate);
  const periodStart = date(record.periodStart);
  const periodEnd = date(record.periodEnd);
  const paidAt = timestamp(record.paidAt);
  const amount = typeof record.amount === "number" && Number.isSafeInteger(record.amount) && record.amount > 0 ? record.amount : undefined;
  const method = typeof record.method === "string" && METHODS.some((candidate) => candidate === record.method) ? record.method as PaymentMethodInput : undefined;
  const status = record.status === "PENDING" || record.status === "CONFIRMED" ? record.status : undefined;
  const notes = record.notes === undefined || record.notes === "" ? undefined : text(record.notes, 500);
  const receiptKey = record.receiptKey === undefined || record.receiptKey === "" ? undefined : text(record.receiptKey, 512);
  if (userId === undefined) issues.push(issue("userId", "El alumno no es válido."));
  if (membershipId === undefined || membershipStartDate === undefined) issues.push(issue("membershipId", "La membresía no es válida."));
  if (amount === undefined) issues.push(issue("amount", "El importe debe ser un entero positivo en PYG."));
  if (method === undefined) issues.push(issue("method", "El método de pago no es válido."));
  if (status === undefined) issues.push(issue("status", "El estado de pago no es válido."));
  if (paidAt === undefined) issues.push(issue("paidAt", "La fecha y hora del pago no es válida."));
  if (periodStart === undefined || periodEnd === undefined || (periodStart !== undefined && periodEnd !== undefined && periodEnd < periodStart)) issues.push(issue("periodEnd", "El periodo pagado no es válido."));
  if (record.notes !== undefined && record.notes !== "" && notes === undefined) issues.push(issue("notes", "Las observaciones no son válidas."));
  if (record.receiptKey !== undefined && record.receiptKey !== "" && (receiptKey === undefined || !/^payment-receipts\/[A-Za-z0-9/_-]{1,450}\.(?:pdf|png|jpe?g)$/u.test(receiptKey))) issues.push(issue("receiptKey", "El comprobante no es válido."));
  return result(issues, {
    amount: amount ?? 0,
    membershipId: membershipId ?? "",
    membershipStartDate: membershipStartDate ?? "",
    method: method ?? "CASH",
    ...(notes === undefined ? {} : { notes }),
    paidAt: paidAt ?? "",
    periodEnd: periodEnd ?? "",
    periodStart: periodStart ?? "",
    ...(receiptKey === undefined ? {} : { receiptKey }),
    status: status ?? "PENDING",
    userId: userId ?? "",
  });
};

export const validatePaymentReceiptUpload = (value: unknown): ValidationResult<PaymentReceiptUploadCommand> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { issues: [issue("$", "El contenido debe ser un objeto.")], success: false };
  const record = value as Record<string, unknown>;
  const allowed = new Set(["contentType", "fileName", "size"]);
  const issues: ValidationIssue[] = Object.keys(record).some((key) => !allowed.has(key)) ? [issue("$", "El contenido incluye campos no permitidos.")] : [];
  const contentType = record.contentType === "application/pdf" || record.contentType === "image/jpeg" || record.contentType === "image/png" ? record.contentType : undefined;
  const fileName = text(record.fileName, 120);
  const size = typeof record.size === "number" && Number.isSafeInteger(record.size) && record.size > 0 && record.size <= 5_242_880 ? record.size : undefined;
  if (contentType === undefined) issues.push(issue("contentType", "Solo se admiten PDF, JPG o PNG."));
  if (fileName === undefined) issues.push(issue("fileName", "El nombre del archivo no es válido."));
  if (size === undefined) issues.push(issue("size", "El comprobante debe pesar como máximo 5 MB."));
  return result(issues, { contentType: contentType ?? "application/pdf", fileName: fileName ?? "", size: size ?? 0 });
};
