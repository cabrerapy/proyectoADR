import { createHmac } from "node:crypto";

import { invalidDynamoDbInput } from "./dynamodb-errors";
import {
  assertTokenVersion,
  asSearchToken,
  type SearchToken,
} from "./model-validation";

const MINIMUM_SECRET_BYTES = 32;
const MINIMUM_NAME_LENGTH = 3;
const MAXIMUM_NAME_LENGTH = 80;
const MAXIMUM_PREFIX_LENGTH = 24;

export interface SearchTokenKey {
  readonly secret: Uint8Array;
  readonly version: string;
}

export interface VersionedSearchToken {
  readonly token: SearchToken;
  readonly version: string;
}

export interface VersionedNamePrefixToken extends VersionedSearchToken {
  readonly prefixLength: number;
}

const normalizedCodePoints = (value: string): readonly string[] =>
  Array.from(value);

export const normalizeEmail = (value: string): string => {
  const normalized = value.trim().normalize("NFKC").toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
  ) {
    throw invalidDynamoDbInput("El correo electrónico no tiene un formato válido.");
  }
  return normalized;
};

export const normalizePersonName = (value: string): string => {
  const normalized = value
    .trim()
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  const length = normalizedCodePoints(normalized).length;
  if (length < MINIMUM_NAME_LENGTH || length > MAXIMUM_NAME_LENGTH) {
    throw invalidDynamoDbInput(
      `El nombre debe tener entre ${MINIMUM_NAME_LENGTH} y ${MAXIMUM_NAME_LENGTH} caracteres normalizados.`,
    );
  }
  return normalized;
};

const normalizeNamePrefix = (value: string): string => {
  const normalized = normalizePersonName(value);
  const characters = normalizedCodePoints(normalized);
  if (characters.length > MAXIMUM_PREFIX_LENGTH) {
    throw invalidDynamoDbInput(
      `La búsqueda por nombre admite hasta ${MAXIMUM_PREFIX_LENGTH} caracteres normalizados.`,
    );
  }
  return normalized;
};

const assertKeys = (
  keys: readonly SearchTokenKey[],
): ReadonlyMap<string, Uint8Array> => {
  if (keys.length < 1 || keys.length > 2) {
    throw invalidDynamoDbInput(
      "La rotación HMAC requiere una o dos versiones activas.",
    );
  }
  const result = new Map<string, Uint8Array>();
  for (const key of keys) {
    let version: string;
    try {
      version = assertTokenVersion(key.version);
    } catch {
      throw invalidDynamoDbInput("La versión de token HMAC no es válida.");
    }
    if (result.has(version)) {
      throw invalidDynamoDbInput("Las versiones HMAC no pueden repetirse.");
    }
    if (!(key.secret instanceof Uint8Array) || key.secret.byteLength < MINIMUM_SECRET_BYTES) {
      throw invalidDynamoDbInput(
        `Cada secreto HMAC debe tener al menos ${MINIMUM_SECRET_BYTES} bytes.`,
      );
    }
    result.set(version, Uint8Array.from(key.secret));
  }
  return result;
};

export class SearchTokenService {
  readonly versions: readonly string[];
  private readonly keys: ReadonlyMap<string, Uint8Array>;

  constructor(keys: readonly SearchTokenKey[]) {
    this.keys = assertKeys(keys);
    this.versions = Object.freeze([...this.keys.keys()].sort());
  }

  assertVersionsAvailable(versions: readonly string[]): void {
    if (
      versions.length < 1 ||
      versions.length > 2 ||
      new Set(versions).size !== versions.length ||
      versions.some((version) => !this.keys.has(version))
    ) {
      throw invalidDynamoDbInput(
        "El perfil requiere una versión HMAC que no está disponible.",
      );
    }
  }

  emailTokens(email: string, versions = this.versions): readonly VersionedSearchToken[] {
    this.assertVersionsAvailable(versions);
    const normalized = normalizeEmail(email);
    return versions.map((version) => ({
      token: this.token(version, "email", normalized),
      version,
    }));
  }

  namePrefixTokens(
    name: string,
    versions = this.versions,
  ): readonly VersionedNamePrefixToken[] {
    this.assertVersionsAvailable(versions);
    const characters = normalizedCodePoints(normalizePersonName(name));
    const maximumLength = Math.min(characters.length, MAXIMUM_PREFIX_LENGTH);
    return versions.flatMap((version) =>
      Array.from(
        { length: maximumLength - MINIMUM_NAME_LENGTH + 1 },
        (_, index) => {
          const prefixLength = index + MINIMUM_NAME_LENGTH;
          return {
            prefixLength,
            token: this.token(
              version,
              "name",
              characters.slice(0, prefixLength).join(""),
            ),
            version,
          };
        },
      ),
    );
  }

  nameSearchTokens(
    prefix: string,
    versions = this.versions,
  ): readonly VersionedSearchToken[] {
    this.assertVersionsAvailable(versions);
    const normalized = normalizeNamePrefix(prefix);
    return versions.map((version) => ({
      token: this.token(version, "name", normalized),
      version,
    }));
  }

  private token(
    version: string,
    purpose: "email" | "name",
    normalizedValue: string,
  ): SearchToken {
    const secret = this.keys.get(version);
    if (secret === undefined) {
      throw invalidDynamoDbInput("La versión HMAC solicitada no está disponible.");
    }
    return asSearchToken(
      createHmac("sha256", secret)
        .update(`gym-adr:${purpose}:${normalizedValue}`, "utf8")
        .digest("hex"),
    );
  }
}
