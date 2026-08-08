import { invalidDynamoDbInput } from "./dynamodb-errors";
import {
  financialDate,
  financialId,
  financialText,
  financialTimestamp,
} from "./financial-validation";

export { financialDate as operationDate, financialId as operationId, financialTimestamp as operationTimestamp };

export const operationText = financialText;

export const positiveInteger = (value: number, label: string, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw invalidDynamoDbInput(`${label} debe ser un entero entre 0 y ${maximum}.`);
  }
  return value;
};

export const objectKey = (value: string, label: string): string => {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 1024 || normalized.startsWith("/") || normalized.includes("..")) {
    throw invalidDynamoDbInput(`${label} no es una clave de objeto válida.`);
  }
  return normalized;
};
