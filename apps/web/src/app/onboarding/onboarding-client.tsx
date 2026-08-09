"use client";

import { useEffect, useState, type FormEvent } from "react";

interface ProfileView {
  readonly completed: boolean;
  readonly displayName: string;
  readonly email: string;
  readonly phone?: string;
  readonly status: "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED" | "INACTIVE";
  readonly version: number;
}

interface ApiFailure {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
}

const parseFailure = async (response: Response): Promise<ApiFailure> => {
  try {
    return await response.json() as ApiFailure;
  } catch {
    return {};
  }
};

export function OnboardingClient() {
  const [profile, setProfile] = useState<ProfileView>();
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ApiFailure["fieldErrors"]>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/onboarding", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const failure = await parseFailure(response);
          throw new Error(failure.message ?? "No pudimos cargar tu perfil.");
        }
        setProfile(await response.json() as ProfileView);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : "No pudimos cargar tu perfil.");
        }
      });
    return () => controller.abort();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (profile === undefined || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    setFieldErrors(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/onboarding", {
        body: JSON.stringify({
          displayName: form.get("displayName"),
          expectedVersion: profile.version,
          phone: form.get("phone"),
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) {
        const failure = await parseFailure(response);
        setFieldErrors(failure.fieldErrors);
        throw new Error(failure.message ?? "No pudimos guardar tu perfil.");
      }
      setProfile(await response.json() as ProfileView);
    } catch (error: unknown) {
      setSubmitError(error instanceof Error ? error.message : "No pudimos guardar tu perfil.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError !== "") {
    return (
      <section aria-labelledby="profile-title" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-slate-950">
        <h1 id="profile-title" className="text-2xl font-bold">Tu sesión no está disponible</h1>
        <p className="mt-3">{loadError}</p>
        <a className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-slate-950 px-5 font-semibold text-white focus:outline-none focus:ring-4 focus:ring-sky-300" href="/api/auth/login">
          Iniciar sesión nuevamente
        </a>
      </section>
    );
  }

  if (profile === undefined) {
    return <p aria-live="polite" className="py-12 text-center text-lg">Cargando tu perfil…</p>;
  }

  if (profile.completed) {
    return (
      <section aria-labelledby="profile-title" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-slate-950">
        <p className="font-semibold text-emerald-800">Perfil enviado correctamente</p>
        <h1 id="profile-title" className="mt-2 text-2xl font-bold">Tu solicitud está pendiente</h1>
        <p className="mt-3">Un administrador revisará tus datos antes de activar tu cuenta.</p>
        <form action="/api/auth/logout" method="post">
          <button className="mt-6 min-h-11 rounded-lg border border-slate-400 px-5 font-semibold focus:outline-none focus:ring-4 focus:ring-sky-300" type="submit">Cerrar sesión</button>
        </form>
      </section>
    );
  }

  return (
    <section aria-labelledby="profile-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <p className="text-sm font-bold uppercase tracking-wide text-sky-700">Último paso</p>
      <h1 id="profile-title" className="mt-2 text-3xl font-bold text-slate-950">Completa tu perfil</h1>
      <p className="mt-3 text-slate-700">Tu cuenta permanecerá pendiente hasta que un administrador la apruebe.</p>
      <form className="mt-7 space-y-5" noValidate onSubmit={submit}>
        <div>
          <label className="block font-semibold text-slate-950" htmlFor="displayName">Nombre y apellido</label>
          <input aria-describedby="displayName-error" aria-invalid={fieldErrors?.displayName !== undefined} className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3 focus:outline-none focus:ring-4 focus:ring-sky-300" defaultValue={profile.displayName} id="displayName" name="displayName" required type="text" />
          <p className="mt-1 text-sm text-red-700" id="displayName-error">{fieldErrors?.displayName?.[0]}</p>
        </div>
        <div>
          <label className="block font-semibold text-slate-950" htmlFor="phone">Teléfono</label>
          <input aria-describedby="phone-help phone-error" aria-invalid={fieldErrors?.phone !== undefined} autoComplete="tel" className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3 focus:outline-none focus:ring-4 focus:ring-sky-300" defaultValue={profile.phone ?? ""} id="phone" inputMode="tel" name="phone" placeholder="+595981123456" required type="tel" />
          <p className="mt-1 text-sm text-slate-600" id="phone-help">Puedes escribir 0981… o incluir el prefijo +595.</p>
          <p className="mt-1 text-sm text-red-700" id="phone-error">{fieldErrors?.phone?.[0]}</p>
        </div>
        <p aria-live="assertive" className="text-sm font-semibold text-red-700">{submitError}</p>
        <button className="min-h-11 w-full rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-wait disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-sky-300 sm:w-auto" disabled={submitting} type="submit">
          {submitting ? "Guardando…" : "Enviar solicitud"}
        </button>
      </form>
    </section>
  );
}
