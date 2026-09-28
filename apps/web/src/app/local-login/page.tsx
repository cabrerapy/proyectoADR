import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LOCAL_IDENTITIES } from "@/server/auth/local-token-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Acceso local",
};

const descriptions = {
  admin: "ADMIN activo: acceso administrativo completo.",
  inactive: "STUDENT inactivo: permite comprobar bloqueos.",
  pending: "STUDENT pendiente: permite comprobar el flujo de aprobación.",
  staff: "STAFF activo: operaciones limitadas, sin permisos exclusivos ADMIN.",
  student: "STUDENT activo con membresía vigente y clases disponibles.",
  suspended: "STUDENT suspendido: permite comprobar bloqueos de reserva.",
} as const;

export default function LocalLoginPage() {
  if (process.env.APP_ENVIRONMENT !== "local" || process.env.LOCAL_AUTH_ENABLED !== "1") {
    notFound();
  }

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto min-h-[70vh] w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-4xl font-black">Acceso local de pruebas</h1>
      <p className="mt-4 max-w-2xl text-muted">
        Estos perfiles contienen datos ficticios y solo existen cuando el entorno local está habilitado.
      </p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {Object.entries(LOCAL_IDENTITIES).map(([alias, identity]) => (
          <li key={alias} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">{identity.displayName}</h2>
            <p className="mt-2 text-sm text-muted">{descriptions[alias as keyof typeof descriptions]}</p>
            <a
              className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-brand-900 px-4 py-2 font-bold text-white"
              href={`/api/auth/local-login?profile=${alias}`}
            >
              Ingresar como {alias.toUpperCase()}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
