import type { CognitoTokenPort, VerifiedIdentity } from "./cognito-client";

export const LOCAL_SESSION_PREFIX = "local-fixture:";

export const LOCAL_IDENTITIES = {
  admin: { cognitoSub: "local-admin", displayName: "Ana Administradora", email: "admin.local@example.test", emailVerified: true },
  inactive: { cognitoSub: "local-inactive", displayName: "Inés Inactiva", email: "inactive.local@example.test", emailVerified: true },
  pending: { cognitoSub: "local-pending", displayName: "Pedro Pendiente", email: "pending.local@example.test", emailVerified: true },
  staff: { cognitoSub: "local-staff", displayName: "Estela Staff", email: "staff.local@example.test", emailVerified: true },
  student: { cognitoSub: "local-student", displayName: "Sofía Alumna", email: "student.local@example.test", emailVerified: true },
  suspended: { cognitoSub: "local-suspended", displayName: "Samuel Suspendido", email: "suspended.local@example.test", emailVerified: true },
} as const satisfies Readonly<Record<string, VerifiedIdentity>>;

export type LocalIdentityAlias = keyof typeof LOCAL_IDENTITIES;

export const isLocalIdentityAlias = (value: string): value is LocalIdentityAlias =>
  Object.hasOwn(LOCAL_IDENTITIES, value);

export class LocalTokenClient implements CognitoTokenPort {
  async exchangeCode(): Promise<string> {
    throw new Error("El intercambio OAuth no está disponible en autenticación local.");
  }

  async verifyIdToken(): Promise<VerifiedIdentity> {
    throw new Error("El callback OAuth no está disponible en autenticación local.");
  }

  async verifySessionToken(token: string): Promise<VerifiedIdentity> {
    if (!token.startsWith(LOCAL_SESSION_PREFIX)) {
      throw new Error("La sesión local no es válida.");
    }
    const alias = token.slice(LOCAL_SESSION_PREFIX.length);
    if (!isLocalIdentityAlias(alias)) {
      throw new Error("El perfil local no existe.");
    }
    return LOCAL_IDENTITIES[alias];
  }
}
