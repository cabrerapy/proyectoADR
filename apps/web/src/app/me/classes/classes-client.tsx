"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

type ReservationStatus = "CONFIRMED" | "CANCELLED" | "ADMIN_CANCELLED";
interface ClassSession { readonly capacity: number; readonly classDate: string; readonly classTypeName: string; readonly confirmedCount: number; readonly endsAt: string; readonly id: string; readonly startsAt: string; readonly status: "SCHEDULED" | "CANCELLED" | "COMPLETED"; readonly trainerName: string }
interface Reservation { readonly classId: string; readonly createdAt: string; readonly id: string; readonly session?: ClassSession; readonly startsAt: string; readonly status: ReservationStatus; readonly updatedAt: string; readonly version: number }
interface SchedulePage { readonly available: readonly ClassSession[]; readonly cursor?: string; readonly reservations: readonly Reservation[] }
interface ApiFailure { readonly message?: string }

const dateKey = (value: Date): string => new Intl.DateTimeFormat("en-CA", {
  day: "2-digit", month: "2-digit", timeZone: "America/Asuncion", year: "numeric",
}).format(value);
const displayDate = (value: string): string => new Intl.DateTimeFormat("es-PY", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/Asuncion",
}).format(new Date(value));
const parseFailure = async (response: Response): Promise<string> => {
  try { return ((await response.json()) as ApiFailure).message ?? "No pudimos completar la operación."; }
  catch { return "No pudimos completar la operación."; }
};
const statusLabels: Readonly<Record<ReservationStatus, string>> = {
  ADMIN_CANCELLED: "Cancelada por el gimnasio", CANCELLED: "Cancelada", CONFIRMED: "Confirmada",
};

export function OwnClassesClient() {
  const [page, setPage] = useState<SchedulePage>();
  const [loading, setLoading] = useState(true);
  const [busyClassId, setBusyClassId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [referenceTime] = useState(() => Date.now());

  const load = useCallback(async (cursor?: string) => {
    setLoading(true); setError("");
    try {
      const now = new Date(); const until = new Date(now); until.setDate(until.getDate() + 14);
      const params = new URLSearchParams({ from: dateKey(now), to: dateKey(until) });
      if (cursor !== undefined) params.set("cursor", cursor);
      const response = await fetch(`/api/v1/me/classes?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await parseFailure(response));
      const result = await response.json() as SchedulePage;
      setPage((current) => cursor === undefined ? result : {
        ...result,
        reservations: [...(current?.reservations ?? []), ...result.reservations],
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "No pudimos consultar tus clases.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const mutate = async (classId: string, method: "DELETE" | "POST") => {
    setBusyClassId(classId); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/v1/class-sessions/${encodeURIComponent(classId)}/reservations`, {
        headers: { "idempotency-key": crypto.randomUUID() }, method,
      });
      if (!response.ok) throw new Error(await parseFailure(response));
      setSuccess(method === "POST" ? "Reserva confirmada." : "Reserva cancelada.");
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "No pudimos completar la operación.");
    } finally { setBusyClassId(""); }
  };

  const upcoming = useMemo(() => page?.reservations.filter((reservation) => reservation.status === "CONFIRMED" && Date.parse(reservation.startsAt) > referenceTime) ?? [], [page, referenceTime]);
  const history = useMemo(() => page?.reservations.filter((reservation) => reservation.status !== "CONFIRMED" || Date.parse(reservation.startsAt) <= referenceTime) ?? [], [page, referenceTime]);
  const reservedClassIds = new Set(upcoming.map(({ classId }) => classId));

  return <div>
    <header className="max-w-3xl"><p className="text-sm font-bold uppercase tracking-wide text-accent">Portal del alumno</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Mis clases</h1><p className="mt-3 leading-7 text-muted">Consulta cupos, reserva una clase y revisa exclusivamente tu historial.</p></header>
    <div aria-live="polite" className="mt-6 min-h-6"><p className="font-semibold text-brand-700">{success}</p><p className="font-semibold text-red-700">{error}</p></div>
    {loading && page === undefined ? <p className="py-16 text-center text-lg">Cargando clases y reservas…</p> : null}
    {page === undefined ? null : <>
      <ScheduleSection id="available-classes" title="Clases disponibles" empty="No hay clases con cupos en los próximos 15 días.">
        {page.available.map((session) => <ClassCard key={session.id} session={session}><button type="button" disabled={busyClassId !== "" || reservedClassIds.has(session.id)} onClick={() => void mutate(session.id, "POST")} className="mt-4 min-h-11 rounded-lg bg-brand-900 px-5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{reservedClassIds.has(session.id) ? "Ya reservada" : busyClassId === session.id ? "Reservando…" : "Reservar"}</button></ClassCard>)}
      </ScheduleSection>
      <ScheduleSection id="upcoming-reservations" title="Mis próximas reservas" empty="No tienes reservas futuras.">
        {upcoming.map((reservation) => <ReservationCard key={reservation.id} reservation={reservation}><button type="button" disabled={busyClassId !== ""} onClick={() => void mutate(reservation.classId, "DELETE")} className="mt-4 min-h-11 rounded-lg border border-brand-900 px-5 font-bold text-brand-900 disabled:opacity-60">{busyClassId === reservation.classId ? "Cancelando…" : "Cancelar reserva"}</button></ReservationCard>)}
      </ScheduleSection>
      <ScheduleSection id="reservation-history" title="Historial de reservas" empty="Todavía no tienes reservas anteriores.">
        {history.map((reservation) => <ReservationCard key={reservation.id} reservation={reservation} />)}
      </ScheduleSection>
      {page.cursor === undefined ? null : <button type="button" disabled={loading} onClick={() => void load(page.cursor)} className="mt-6 min-h-11 rounded-lg border border-brand-900 px-6 font-bold text-brand-900 disabled:opacity-60">{loading ? "Cargando…" : "Cargar más historial"}</button>}
    </>}
  </div>;
}

function ScheduleSection({ children, empty, id, title }: { readonly children: readonly ReactNode[]; readonly empty: string; readonly id: string; readonly title: string }) {
  return <section className="mt-10" aria-labelledby={id}><h2 className="text-2xl font-black" id={id}>{title}</h2>{children.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-slate-400 p-6 text-center text-muted">{empty}</p> : <ul className="mt-5 grid gap-4 md:grid-cols-2">{children.map((child, index) => <li key={index}>{child}</li>)}</ul>}</section>;
}
function ClassCard({ children, session }: { readonly children?: ReactNode; readonly session: ClassSession }) {
  const places = Math.max(0, session.capacity - session.confirmedCount);
  return <article className="h-full rounded-2xl border border-black/10 bg-surface p-5 shadow-sm"><h3 className="text-xl font-black">{session.classTypeName}</h3><p className="mt-2 font-bold">{displayDate(session.startsAt)}</p><p className="mt-1 text-muted">Entrenador: {session.trainerName}</p><p className="mt-3 font-bold text-brand-700">{places} {places === 1 ? "cupo disponible" : "cupos disponibles"}</p>{children}</article>;
}
function ReservationCard({ children, reservation }: { readonly children?: ReactNode; readonly reservation: Reservation }) {
  return <article className="h-full rounded-2xl border border-black/10 bg-surface p-5 shadow-sm"><h3 className="text-xl font-black">{reservation.session?.classTypeName ?? "Clase"}</h3><p className="mt-2 font-bold">{displayDate(reservation.startsAt)}</p>{reservation.session === undefined ? null : <p className="mt-1 text-muted">Entrenador: {reservation.session.trainerName}</p>}<p className="mt-3 text-sm font-bold">{statusLabels[reservation.status]}</p>{children}</article>;
}
