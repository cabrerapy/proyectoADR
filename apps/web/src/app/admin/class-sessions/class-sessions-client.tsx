"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

interface CatalogItem { readonly id: string; readonly name: string }
interface CatalogPage { readonly items: readonly CatalogItem[] }
interface Session { readonly capacity: number; readonly classTypeId: string; readonly classTypeName: string; readonly confirmedCount: number; readonly endsAt: string; readonly id: string; readonly startsAt: string; readonly status: string; readonly trainerId: string; readonly trainerName: string; readonly version: number }
interface SessionPage { readonly sessions: readonly Session[] }
interface ApiFailure { readonly message?: string }
interface CancellationResponse { readonly propagation: { readonly cancelledCount: number; readonly complete: boolean; readonly cursor?: string }; readonly session: Session }
interface CancellationProgress { readonly cursor?: string; readonly expectedVersion: number; readonly reason: string; readonly requestKey: string; readonly sessionId: string }

const localDate = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());
const localInput = (timestamp: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", hour: "2-digit", hour12: false, minute: "2-digit", month: "2-digit", timeZone: "America/Asuncion", year: "numeric" }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
};
const failure = async (response: Response): Promise<string> => {
  try { return ((await response.json()) as ApiFailure).message ?? "La operación no pudo completarse."; }
  catch { return "La operación no pudo completarse."; }
};
const command = (data: FormData) => ({
  capacity: Number(data.get("capacity")),
  classTypeId: String(data.get("classTypeId")),
  endsAt: new Date(String(data.get("endsAt"))).toISOString(),
  startsAt: new Date(String(data.get("startsAt"))).toISOString(),
  trainerId: String(data.get("trainerId")),
});

export function AdminClassSessionsClient() {
  const [date, setDate] = useState(localDate);
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [trainers, setTrainers] = useState<readonly CatalogItem[]>([]);
  const [types, setTypes] = useState<readonly CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cancellation, setCancellation] = useState<CancellationProgress>();

  const load = useCallback(async (selectedDate: string) => {
    setLoading(true);
    setError("");
    try {
      const [sessionResponse, trainerResponse, typeResponse] = await Promise.all([
        fetch(`/api/v1/admin/class-sessions?date=${encodeURIComponent(selectedDate)}`, { cache: "no-store" }),
        fetch("/api/v1/admin/trainers?status=ACTIVE", { cache: "no-store" }),
        fetch("/api/v1/admin/class-types?status=ACTIVE", { cache: "no-store" }),
      ]);
      if (!sessionResponse.ok) throw new Error(await failure(sessionResponse));
      if (!trainerResponse.ok) throw new Error(await failure(trainerResponse));
      if (!typeResponse.ok) throw new Error(await failure(typeResponse));
      setSessions(((await sessionResponse.json()) as SessionPage).sessions);
      setTrainers(((await trainerResponse.json()) as CatalogPage).items);
      setTypes(((await typeResponse.json()) as CatalogPage).items);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar las sesiones.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(date), 0);
    return () => window.clearTimeout(timeout);
  }, [date, load]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy !== "") return;
    const form = event.currentTarget;
    setBusy("new"); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/v1/admin/class-sessions", { body: JSON.stringify(command(new FormData(form))), headers: { "content-type": "application/json" }, method: "POST" });
      if (!response.ok) throw new Error(await failure(response));
      form.reset(); setSuccess("Sesión creada correctamente."); await load(date);
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "No pudimos crear la sesión."); }
    finally { setBusy(""); }
  };

  const update = async (event: FormEvent<HTMLFormElement>, session: Session) => {
    event.preventDefault();
    if (busy !== "") return;
    setBusy(session.id); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/v1/admin/class-sessions/${encodeURIComponent(session.id)}`, { body: JSON.stringify({ ...command(new FormData(event.currentTarget)), expectedVersion: session.version }), headers: { "content-type": "application/json" }, method: "PATCH" });
      if (!response.ok) throw new Error(await failure(response));
      setSuccess("Sesión actualizada correctamente."); await load(date);
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "No pudimos actualizar la sesión."); }
    finally { setBusy(""); }
  };

  const cancel = async (event: FormEvent<HTMLFormElement>, session: Session) => {
    event.preventDefault();
    if (busy !== "") return;
    const reason = String(new FormData(event.currentTarget).get("reason")).trim();
    let progress = cancellation?.sessionId === session.id
      ? cancellation
      : { expectedVersion: session.version, reason, requestKey: crypto.randomUUID(), sessionId: session.id };
    setCancellation(progress); setBusy(`cancel-${session.id}`); setError(""); setSuccess("");
    try {
      while (true) {
        const response = await fetch(`/api/v1/admin/class-sessions/${encodeURIComponent(session.id)}/cancellation`, {
          body: JSON.stringify({ ...(progress.cursor === undefined ? {} : { cursor: progress.cursor }), expectedVersion: progress.expectedVersion, reason: progress.reason }),
          headers: { "content-type": "application/json", "idempotency-key": progress.requestKey },
          method: "POST",
        });
        if (!response.ok) throw new Error(await failure(response));
        const result = (await response.json()) as CancellationResponse;
        if (result.propagation.complete) {
          setCancellation(undefined);
          setSuccess("Sesión cancelada y reservas propagadas correctamente.");
          await load(date);
          break;
        }
        if (result.propagation.cursor === undefined) throw new Error("La propagación no devolvió un cursor reanudable.");
        progress = { ...progress, cursor: result.propagation.cursor };
        setCancellation(progress);
      }
    } catch (reasonCaught: unknown) {
      setError(reasonCaught instanceof Error ? `${reasonCaught.message} Puedes reanudar la cancelación.` : "No pudimos completar la cancelación. Puedes reanudarla.");
    } finally { setBusy(""); }
  };

  const referencesReady = trainers.length > 0 && types.length > 0;
  return <div>
    <header><p className="text-sm font-bold uppercase tracking-wide text-accent">Administración</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Sesiones de clase</h1><p className="mt-3 max-w-3xl leading-7 text-muted">Crea, edita o cancela sesiones concretas. La cancelación bloquea nuevas reservas de inmediato y propaga las existentes en lotes reanudables.</p></header>
    <label className="mt-8 block max-w-sm font-bold" htmlFor="session-date">Fecha a consultar<input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="session-date" onChange={(event) => setDate(event.currentTarget.value)} type="date" value={date} /></label>
    {referencesReady ? <form className="mt-8 grid gap-4 rounded-2xl border border-black/10 bg-surface p-5 sm:grid-cols-2" onSubmit={(event) => void create(event)}><h2 className="text-2xl font-black sm:col-span-2">Crear sesión</h2><SessionFields prefix="new" trainers={trainers} types={types} /><button className="min-h-11 rounded-lg bg-brand-900 px-5 font-bold text-white disabled:opacity-60 sm:col-span-2" disabled={busy !== ""} type="submit">{busy === "new" ? "Creando…" : "Crear sesión"}</button></form> : !loading ? <p className="mt-6 rounded-xl border border-dashed border-slate-400 p-5 text-muted">Activa al menos un entrenador y un tipo de clase para crear sesiones.</p> : null}
    <p aria-live="polite" className="mt-4 font-semibold text-emerald-700">{success}</p><p aria-live="assertive" className="mt-2 font-semibold text-red-700">{error}</p>
    {loading ? <p className="py-10 text-center">Cargando sesiones…</p> : sessions.length === 0 ? <p className="mt-6 rounded-xl bg-canvas p-6 text-center text-muted">No hay sesiones para esta fecha.</p> : <ul className="mt-8 grid gap-4 lg:grid-cols-2">{sessions.map((session) => <li className="rounded-2xl border border-black/10 bg-surface p-5" key={session.id}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-black">{session.classTypeName}</h2><span className="rounded-full bg-canvas px-3 py-1 text-sm font-bold">{session.status === "CANCELLED" ? "Cancelada" : "Programada"}</span></div><p className="mt-1 text-muted">{session.trainerName} · {session.confirmedCount}/{session.capacity} reservas</p>{session.status === "SCHEDULED" ? <><form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => void update(event, session)}><SessionFields prefix={session.id} session={session} trainers={trainers} types={types} /><button className="min-h-11 rounded-lg bg-accent px-4 font-bold disabled:opacity-60 sm:col-span-2" disabled={busy !== ""} type="submit">{busy === session.id ? "Guardando…" : "Guardar cambios"}</button></form><form className="mt-5 border-t border-black/10 pt-5" onSubmit={(event) => void cancel(event, session)}><label className="font-bold" htmlFor={`reason-${session.id}`}>Motivo de cancelación<textarea className="mt-1 min-h-24 w-full rounded-lg border border-slate-400 px-3 py-2" defaultValue={cancellation?.sessionId === session.id ? cancellation.reason : undefined} disabled={cancellation?.sessionId === session.id} id={`reason-${session.id}`} maxLength={500} minLength={8} name="reason" required /></label><button className="mt-3 min-h-11 rounded-lg bg-red-700 px-4 font-bold text-white disabled:opacity-60" disabled={busy !== ""} type="submit">{busy === `cancel-${session.id}` ? "Cancelando…" : cancellation?.sessionId === session.id ? "Reanudar cancelación" : "Cancelar sesión"}</button></form></> : <><p className="mt-4 rounded-lg bg-red-50 p-3 text-red-800">Esta sesión no acepta nuevas reservas.</p><form className="mt-5 border-t border-black/10 pt-5" onSubmit={(event) => void cancel(event, session)}><label className="font-bold" htmlFor={`reason-${session.id}`}>Motivo para reanudar<textarea className="mt-1 min-h-24 w-full rounded-lg border border-slate-400 px-3 py-2" defaultValue={cancellation?.sessionId === session.id ? cancellation.reason : undefined} disabled={cancellation?.sessionId === session.id} id={`reason-${session.id}`} maxLength={500} minLength={8} name="reason" required /></label><button className="mt-3 min-h-11 rounded-lg bg-red-700 px-4 font-bold text-white disabled:opacity-60" disabled={busy !== ""} type="submit">{busy === `cancel-${session.id}` ? "Reanudando…" : "Reanudar propagación"}</button></form></>}</li>)}</ul>}
  </div>;
}

function SessionFields({ prefix, session, trainers, types }: { readonly prefix: string; readonly session?: Session; readonly trainers: readonly CatalogItem[]; readonly types: readonly CatalogItem[] }) {
  return <><label className="font-bold" htmlFor={`type-${prefix}`}>Tipo de clase<select className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={session?.classTypeId} id={`type-${prefix}`} name="classTypeId" required>{types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="font-bold" htmlFor={`trainer-${prefix}`}>Entrenador<select className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={session?.trainerId} id={`trainer-${prefix}`} name="trainerId" required>{trainers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="font-bold" htmlFor={`starts-${prefix}`}>Inicio<input className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={session === undefined ? undefined : localInput(session.startsAt)} id={`starts-${prefix}`} name="startsAt" required type="datetime-local" /></label><label className="font-bold" htmlFor={`ends-${prefix}`}>Fin<input className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={session === undefined ? undefined : localInput(session.endsAt)} id={`ends-${prefix}`} name="endsAt" required type="datetime-local" /></label><label className="font-bold sm:col-span-2" htmlFor={`capacity-${prefix}`}>Capacidad<input className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={session?.capacity} id={`capacity-${prefix}`} min={Math.max(1, session?.confirmedCount ?? 1)} name="capacity" required step={1} type="number" /></label></>;
}
