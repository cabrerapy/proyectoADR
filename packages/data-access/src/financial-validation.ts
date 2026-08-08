import { NumberValue } from "@aws-sdk/lib-dynamodb";

import { invalidDynamoDbInput } from "./dynamodb-errors";
import { assertDate, assertOpaqueSegment, assertTimestamp } from "./model-validation";

export const financialId = (value: string, label: string): string => {
  try {
    return assertOpaqueSegment(value, label);
  } catch {
    throw invalidDynamoDbInput(`${label} no tiene un formato válido.`);
  }
};

export const financialDate = (value: string, label: string): string => {
  try {
    const result = assertDate(value, label);
    const date = new Date(`${result}T00:00:00Z`);
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== result) {
      throw new Error("invalid date");
    }
    return result;
  } catch {
    throw invalidDynamoDbInput(`${label} no es una fecha válida.`);
  }
};

export const financialTimestamp = (value: string, label: string): string => {
  try {
    const result = assertTimestamp(value, label);
    if (!Number.isFinite(Date.parse(result))) {
      throw new Error("invalid timestamp");
    }
    return result;
  } catch {
    throw invalidDynamoDbInput(`${label} no es un timestamp UTC válido.`);
  }
};

export const financialAmount = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidDynamoDbInput(`${label} debe ser un entero positivo.`);
  }
  return value;
};

export const financialCurrency = (value: string): string => {
  if (!/^[A-Z]{3}$/u.test(value)) {
    throw invalidDynamoDbInput("La moneda debe usar ISO 4217.");
  }
  return value;
};

export const financialText = (
  value: string,
  label: string,
  maximumLength: number,
): string => {
  const result = value.trim().normalize("NFKC").replace(/\s+/gu, " ");
  if (result.length < 1 || result.length > maximumLength) {
    throw invalidDynamoDbInput(
      `${label} debe contener entre 1 y ${maximumLength} caracteres.`,
    );
  }
  return result;
};

export const optionalFinancialText = (
  value: string | undefined,
  label: string,
  maximumLength: number,
): string | undefined => value === undefined
  ? undefined
  : financialText(value, label, maximumLength);

export const readFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (!(value instanceof NumberValue)) {
    return undefined;
  }
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const tableName = (value: string): string => {
  if (!/^[A-Za-z0-9_.-]{3,255}$/u.test(value)) {
    throw invalidDynamoDbInput("El nombre de tabla DynamoDB no es válido.");
  }
  return value;
};
