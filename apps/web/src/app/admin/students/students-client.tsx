"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type UserStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED" | "INACTIVE";
type StudentFilter = "pending" | "status" | "email" | "name";

interface StudentView {
  readonly createdAt: string;
  readonly displayName: string;
  readonly email?: string;
  readonly id: string;
  readonly onboardingCompleted: boolean;
  readonly phone?: string;
  readonly roles?: readonly ("STUDENT" | "STAFF" | "ADMIN")[];
  readonly status: UserStatus;
  readonly updatedAt: string;
  readonly version: number;
}

interface StudentPage {
  readonly capabilities: {
    readonly canManageStatus: boolean;
    readonly canReadFull: boolean;
  };
  readonly cursor?: string;
  readonly students: readonly StudentView[];
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

const nextStatuses: Readonly<Record<UserStatus, readonly UserStatus[]>> = {
  ACTIVE: ["SUSPENDED", "INACTIVE"],
  INACTIVE: ["ACTIVE"],
  PENDING: ["ACTIVE", "REJECTED"],
  REJECTED: [],
  SUSPENDED: ["ACTIVE", "INACTIVE"],
};

const parseFailure = async (response: Response): Promise<ApiFailure> => {
  try {
    return await response.json() as ApiFailure;
  } catch {
    return {};
  }
};

const formatDate = (value: string): string => new Intl.DateTimeFormat("es-PY", {
  dateStyle: "medium",
  timeZone: "America/Asuncion",
}).format(new Date(value));

const queryUrl = (filter: StudentFilter, value: string, cursor?: string): string => {
  const params = new URLSearchParams({ filter });
  if (filter !== "pending") params.set("value", value);
  if (cursor !== undefined) params.set("cursor", cursor);
  return `/api/v1/admin/students?${params.toString()}`;
};

export function AdminStudentsClient() {
  const [filter, setFilter] = useState<StudentFilter>("pending");
  const [value, setValue] = useState("");
  const [page, setPage] = useState<StudentPage>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [transitionError, setTransitionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [transitioningId, setTransitioningId] = useState<string>();

  const load = useCallback(async (
    requestedFilter: StudentFilter,
    requestedValue: string,
    cursor?: string,
  ) => {
    if (cursor === undefined) setLoading(true);
    else setLoadingMore(true);
    setLoadError("");
    try {
      const response = await fetch(queryUrl(requestedFilter, requestedValue, cursor), {
        cache: "no-store",
      });
      if (!response.ok) {
        const failure = await parseFailure(response);
        throw new Error(failure.message ?? "No pudimos consultar los alumnos.");
      }
      const result = await response.json() as StudentPage;
      setPage((current) => cursor === undefined
        ? result
        : { ...result, students: [...(current?.students ?? []), ...result.students] });
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : "No pudimos consultar los alumnos.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load("pending", ""), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccessMessage("");
    setTransitionError("");
    void load(filter, value);
  };

  const transition = async (event: FormEvent<HTMLFormElement>, student: StudentView) => {
    event.preventDefault();
    if (transitioningId !== undefined) return;
    const form = new FormData(event.currentTarget);
    const status = form.get("status");
    if (typeof status !== "string" || status === "") return;
    setTransitioningId(student.id);
    setTransitionError("");
    setSuccessMessage("");
    try {
      const reason = form.get("reason");
      const response = await fetch(`/api/v1/admin/students/${encodeURIComponent(student.id)}`, {
        body: JSON.stringify({
          expectedVersion: student.version,
          ...(typeof reason === "string" && reason.trim() !== "" ? { reason } : {}),
          status,
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) {
        const failure = await parseFailure(response);
        throw new Error(failure.message ?? "No pudimos actualizar la solicitud.");
      }
      const updated = await response.json() as StudentView;
      setPage((current) => current === undefined
        ? current
        : {
            ...current,
            students: current.students
              .map((entry) => entry.id === updated.id ? updated : entry)
              .filter((entry) => filter === "pending"
                ? entry.status === "PENDING"
                : filter !== "status" || entry.status === value),
          });
      setSuccessMessage(`${student.displayName}: estado actualizado a ${statusLabels[updated.status]}.`);
    } catch (error: unknown) {
      setTransitionError(error instanceof Error ? error.message : "No pudimos actualizar la solicitud.");
    } finally {
      setTransitioningId(undefined);
    }
  };

  return (
    <div>
      <header className="max-w-3xl">
        <p className="text-sm font-bold uppercase tracking-wide text-accent">Administración</p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">Alumnos y solicitudes</h1>
        <p className="mt-3 leading-7 text-muted">Consulta alumnos por los índices aprobados y revisa solicitudes pendientes.</p>
      </header>

      <form className="mt-8 grid gap-4 rounded-2xl border border-black/10 bg-surface p-5 sm:grid-cols-[12rem_1fr_auto] sm:items-end" onSubmit={search}>
        <div>
          <label className="block font-bold" htmlFor="student-filter">Buscar por</label>
          <select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="student-filter" value={filter} onChange={(event) => {
            const next = event.currentTarget.value as StudentFilter;
            setFilter(next);
            setValue(next === "status" ? "ACTIVE" : "");
          }}>
            <option value="pending">Solicitudes pendientes</option>
            <option value="status">Estado</option>
            <option value="name">Nombre</option>
            <option value="email">Correo — solo administrador</option>
          </select>
        </div>
        {filter === "status" ? (
          <div>
            <label className="block font-bold" htmlFor="student-query">Estado</label>
            <select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="student-query" value={value} onChange={(event) => setValue(event.currentTarget.value)}>
              {Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
            </select>
          </div>
        ) : filter === "pending" ? <p className="pb-2 text-sm text-muted">Muestra las cuentas que esperan revisión.</p> : (
          <div>
            <label className="block font-bold" htmlFor="student-query">{filter === "email" ? "Correo exacto" : "Inicio del nombre"}</label>
            <input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="student-query" maxLength={filter === "name" ? 24 : 254} minLength={filter === "name" ? 3 : undefined} required type={filter === "email" ? "email" : "search"} value={value} onChange={(event) => setValue(event.currentTarget.value)} />
          </div>
        )}
        <button className="min-h-11 rounded-lg bg-brand-900 px-6 font-bold text-white disabled:opacity-60" disabled={loading} type="submit">{loading ? "Buscando…" : "Buscar"}</button>
      </form>

      <p aria-live="polite" className="mt-5 font-semibold text-emerald-700">{successMessage}</p>
      <p aria-live="assertive" className="mt-2 font-semibold text-red-700">{transitionError || loadError}</p>

      {loading ? (
        <p aria-live="polite" className="py-16 text-center text-lg">Cargando alumnos…</p>
      ) : page === undefined || page.students.length === 0 ? (
        <section className="mt-8 rounded-2xl border border-dashed border-slate-400 p-8 text-center" aria-labelledby="empty-students-title">
          <h2 className="text-xl font-black" id="empty-students-title">No hay resultados</h2>
          <p className="mt-2 text-muted">Prueba otro filtro o vuelve a consultar más tarde.</p>
        </section>
      ) : (
        <section className="mt-8" aria-labelledby="student-results-title">
          <h2 className="text-2xl font-black" id="student-results-title">Resultados</h2>
          <ul className="mt-5 grid gap-4 xl:grid-cols-2">
            {page.students.map((student) => (
              <li className="rounded-2xl border border-black/10 bg-surface p-5 shadow-sm" key={student.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="text-xl font-black">{student.displayName}</h3><p className="mt-1 text-sm text-muted">Ingreso: {formatDate(student.createdAt)}</p></div>
                  <span className="rounded-full bg-canvas px-3 py-1 text-sm font-bold">{statusLabels[student.status]}</span>
                </div>
                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="font-bold">Perfil inicial</dt><dd>{student.onboardingCompleted ? "Completo" : "Incompleto"}</dd></div>
                  {student.email === undefined ? null : <div><dt className="font-bold">Correo</dt><dd className="break-all">{student.email}</dd></div>}
                  {student.phone === undefined ? null : <div><dt className="font-bold">Teléfono</dt><dd>{student.phone}</dd></div>}
                </dl>
                {page.capabilities.canManageStatus && nextStatuses[student.status].length > 0 ? (
                  <form className="mt-6 grid gap-3 rounded-xl bg-canvas p-4" onSubmit={(event) => void transition(event, student)}>
                    <label className="font-bold" htmlFor={`status-${student.id}`}>Nuevo estado</label>
                    <select className="min-h-11 rounded-lg border border-slate-400 px-3" defaultValue="" id={`status-${student.id}`} name="status" required>
                      <option disabled value="">Seleccionar</option>
                      {nextStatuses[student.status].map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
                    </select>
                    <label className="font-bold" htmlFor={`reason-${student.id}`}>Motivo cuando corresponda</label>
                    <textarea className="min-h-24 rounded-lg border border-slate-400 p-3" id={`reason-${student.id}`} maxLength={300} name="reason" />
                    <button className="min-h-11 rounded-lg bg-accent px-5 font-bold text-brand-900 disabled:cursor-wait disabled:opacity-60" disabled={transitioningId !== undefined} type="submit">{transitioningId === student.id ? "Actualizando…" : "Confirmar cambio"}</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          {page.cursor === undefined ? null : (
            <button className="mt-6 min-h-11 rounded-lg border border-brand-900 px-6 font-bold text-brand-900 disabled:opacity-60" disabled={loadingMore} onClick={() => void load(filter, value, page.cursor)} type="button">{loadingMore ? "Cargando…" : "Cargar más"}</button>
          )}
        </section>
      )}
    </div>
  );
}
