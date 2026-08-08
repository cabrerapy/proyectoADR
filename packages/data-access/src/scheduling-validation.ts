import { invalidDynamoDbInput } from "./dynamodb-errors";
import {
  financialDate,
  financialId,
  financialText,
  financialTimestamp,
  readFiniteNumber,
  tableName,
} from "./financial-validation";
import { assertTime } from "./model-validation";

export {
  financialDate as schedulingDate,
  financialId as schedulingId,
  financialText as schedulingText,
  financialTimestamp as schedulingTimestamp,
  readFiniteNumber as readSchedulingNumber,
  tableName as schedulingTableName,
};

export const schedulingTime = (value: string, label: string): string => {
  try {
    const time = assertTime(value, label);
    const [hour, minute, second] = time.split(":").map(Number);
    if (
      hour === undefined ||
      minute === undefined ||
      second === undefined ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      throw new Error("invalid time");
    }
    return time;
  } catch {
    throw invalidDynamoDbInput(`${label} no es una hora válida.`);
  }
};

export const schedulingCapacity = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw invalidDynamoDbInput("La capacidad debe ser un entero entre 1 y 500.");
  }
  return value;
};
