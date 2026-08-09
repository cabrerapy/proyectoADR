"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type UserStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED" | "INACTIVE";
type UserRole = "STUDENT" | "STAFF" | "ADMIN";

interface OwnProfileView {
  readonly displayName: string;
  readonly email: string;
  readonly emailNotificationsEnabled: boolean;
  readonly joinedAt: string;
  readonly onboardingCompleted: boolean;
  readonly phone?: string;
  readonly roles: readonly UserRole[];
  readonly status: UserStatus;
  readonly updatedAt: string;
  readonly version: number;
}

interface ApiFailure {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
}

const statusLabels: Readonly<Record<UserStatus, string>> = {
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  PENDING: "Pendiente",
  REJECTED: "Rechazado",
  SUSPENDED: "Suspendido",
};

const roleLabels: Readonly<Record<UserRole, string>> = {
  ADMIN: "Administrador",
  STAFF: "Personal",
  STUDENT: "Alumno",
};

const parseFailure = async (response: Response): Promise<ApiFailure> => {
  try {
    return await response.json() as ApiFailure;
  } catch {
    return {};
  }
};

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("es-PY", {
    dateStyle: "long",
    timeZone: "America/Asuncion",
  }).format(new Date(value));

export function ProfileClient() {
  const [profile, setProfile] = useState<OwnProfileView>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ApiFailure["fieldErrors"]>();
  const [submitting, setSubmitting] = useState(false);

  const loadProfile = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/v1/me/profile", {
        cache: "no-store",
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) {
        const failure = await parseFailure(response);
        throw new Error(failure.message ?? "No pudimos cargar tu perfil.");
      }
      setProfile(await response.json() as OwnProfileView);
    } catch (error: unknown) {
      if (!signal?.aborted) {
        setLoadError(error instanceof Error ? error.message : "No pudimos cargar tu perfil.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const retry = () => {
    setLoading(true);
    setLoadError("");
    void loadProfile();
  };

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void loadProfile(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadProfile]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (profile === undefined || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    setSuccessMessage("");
    setFieldErrors(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/me/profile", {
        body: JSON.stringify({
          displayName: form.get("displayName"),
          emailNotificationsEnabled: form.get("emailNotificationsEnabled") === "on",
          expectedVersion: profile.version,
          phone: form.get("phone"),
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) {
        const failure = await parseFailure(response);
        setFieldErrors(failure.fieldErrors);
        throw new Error(failure.message ?? "No pudimos actualizar tu perfil.");
      }
      setProfile(await response.json() as OwnProfileView);
      setSuccessMessage("Tus datos se actualizaron correctamente.");
    } catch (error: unknown) {
      setSubmitError(error instanceof Error ? error.message : "No pudimos actualizar tu perfil.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <p aria-live="polite" className="py-16 text-center text-lg">Cargando tu perfil…</p>;
  }

  if (loadError !== "" || profile === undefined) {
    return (
      <section aria-labelledby="profile-error-title" className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <h1 id="profile-error-title" className="text-2xl font-black">No pudimos mostrar tu perfil</h1>
        <p className="mt-3 text-muted">{loadError || "El perfil no está disponible."}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="min-h-11 rounded-lg bg-brand-900 px-5 font-bold text-white" onClick={retry} type="button">Reintentar</button>
          <Link className="inline-flex min-h-11 items-center rounded-lg border border-brand-900 px-5 font-bold text-brand-900" href="/api/auth/login">Iniciar sesión</Link>
        </div>
      </section>
    );
  }

  if (!profile.onboardingCompleted) {
    return (
      <section aria-labelledby="profile-incomplete-title" className="rounded-2xl border border-accent bg-accent/15 p-6">
        <h1 id="profile-incomplete-title" className="text-2xl font-black">Primero completá tu solicitud</h1>
        <p className="mt-3 text-muted">Necesitamos tus datos iniciales antes de habilitar la edición del perfil.</p>
        <Link className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-brand-900 px-5 font-bold text-white" href="/onboarding">Completar perfil inicial</Link>
      </section>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr]">
      <aside className="h-fit rounded-2xl bg-brand-900 p-6 text-white" aria-labelledby="account-summary-title">
        <p className="text-sm font-bold uppercase tracking-wide text-accent">Cuenta</p>
        <h1 id="account-summary-title" className="mt-2 text-3xl font-black">Mi perfil</h1>
        <dl className="mt-7 grid gap-5">
          <div><dt className="text-sm text-white/70">Correo verificado</dt><dd className="mt-1 break-all font-semibold">{profile.email}</dd></div>
          <div><dt className="text-sm text-white/70">Estado</dt><dd className="mt-1 font-semibold">{statusLabels[profile.status]}</dd></div>
          <div><dt className="text-sm text-white/70">Rol</dt><dd className="mt-1 font-semibold">{profile.roles.map((role) => roleLabels[role]).join(", ")}</dd></div>
          <div><dt className="text-sm text-white/70">Fecha de ingreso</dt><dd className="mt-1 font-semibold">{formatDate(profile.joinedAt)}</dd></div>
        </dl>
      </aside>

      <section aria-labelledby="editable-profile-title" className="rounded-2xl border border-black/10 bg-surface p-5 shadow-sm sm:p-8">
        <h2 id="editable-profile-title" className="text-2xl font-black">Datos de contacto y preferencias</h2>
        <p className="mt-2 leading-7 text-muted">Tu estado, rol, correo y fecha de ingreso sólo pueden modificarse mediante los procesos autorizados.</p>
        <form key={profile.version} className="mt-7 space-y-5" noValidate onSubmit={submit}>
          <div>
            <label className="block font-bold" htmlFor="displayName">Nombre y apellido</label>
            <input aria-describedby="displayName-error" aria-invalid={fieldErrors?.displayName !== undefined} className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={profile.displayName} id="displayName" name="displayName" required type="text" />
            <p className="mt-1 text-sm text-red-700" id="displayName-error">{fieldErrors?.displayName?.[0]}</p>
          </div>
          <div>
            <label className="block font-bold" htmlFor="phone">Teléfono</label>
            <input aria-describedby="phone-help phone-error" aria-invalid={fieldErrors?.phone !== undefined} autoComplete="tel" className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={profile.phone ?? ""} id="phone" inputMode="tel" name="phone" required type="tel" />
            <p className="mt-1 text-sm text-muted" id="phone-help">Podés escribir 0981… o incluir el prefijo +595.</p>
            <p className="mt-1 text-sm text-red-700" id="phone-error">{fieldErrors?.phone?.[0]}</p>
          </div>
          <label className="flex min-h-11 items-start gap-3 rounded-xl bg-canvas p-4">
            <input className="mt-1 size-5" defaultChecked={profile.emailNotificationsEnabled} name="emailNotificationsEnabled" type="checkbox" />
            <span><strong className="block">Recibir notificaciones por correo</strong><span className="mt-1 block text-sm text-muted">Incluye avisos relacionados con tu membresía.</span></span>
          </label>
          <p aria-live="polite" className="font-semibold text-emerald-700">{successMessage}</p>
          <p aria-live="assertive" className="font-semibold text-red-700">{submitError}</p>
          <button className="min-h-12 w-full rounded-lg bg-accent px-5 font-bold text-brand-900 disabled:cursor-wait disabled:opacity-60 sm:w-auto" disabled={submitting} type="submit">{submitting ? "Guardando…" : "Guardar cambios"}</button>
        </form>
      </section>
    </div>
  );
}
