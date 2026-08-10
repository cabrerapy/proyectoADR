import type { NonEmptyReadonlyArray } from "@gym-adr/shared";

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path: readonly (number | string)[];
}

export type ValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | {
      readonly success: false;
      readonly issues: NonEmptyReadonlyArray<ValidationIssue>;
    };

export * from "./admin-student";
export * from "./membership-plan";
export * from "./membership";
export * from "./payment";
export * from "./profile";
export * from "./scheduling-catalog";
export * from "./class-session";
