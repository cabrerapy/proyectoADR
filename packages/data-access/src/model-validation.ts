const opaqueSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const yearMonthPattern = /^\d{4}-\d{2}$/u;
const timePattern = /^\d{2}:\d{2}:\d{2}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const tokenPattern = /^[a-f0-9]{64}$/u;
const tokenVersionPattern = /^v[1-9]\d*$/u;

declare const searchTokenBrand: unique symbol;

export type SearchToken = string & {
  readonly [searchTokenBrand]: "SearchToken";
};

export class KeyValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "KeyValidationError";
  }
}

const assertPattern = (
  value: string,
  pattern: RegExp,
  label: string,
): string => {
  if (!pattern.test(value)) {
    throw new KeyValidationError(`${label} no tiene un formato válido.`);
  }

  return value;
};

export const assertOpaqueSegment = (value: string, label: string): string =>
  assertPattern(value, opaqueSegmentPattern, label);

export const assertDate = (value: string, label = "date"): string =>
  assertPattern(value, datePattern, label);

export const assertYearMonth = (value: string): string =>
  assertPattern(value, yearMonthPattern, "yearMonth");

export const assertTime = (value: string, label = "time"): string =>
  assertPattern(value, timePattern, label);

export const assertTimestamp = (
  value: string,
  label = "timestamp",
): string => assertPattern(value, timestampPattern, label);

export const assertTokenVersion = (value: string): string =>
  assertPattern(value, tokenVersionPattern, "tokenVersion");

export const asSearchToken = (value: string): SearchToken =>
  assertPattern(value, tokenPattern, "searchToken") as SearchToken;
