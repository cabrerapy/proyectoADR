"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type MembershipStatus = "PENDING" | "ACTIVE" | "EXPIRED" | "SUSPENDED" | "CANCELLED";
type Standing = "UPCOMING" | "CURRENT" | "OVERDUE" | "INACTIVE";
interface Plan { readonly id: string; readonly name: string; readonly price: number }
interface Membership {
  readonly endDate: string;
  readonly expectedAmount: number;
  readonly id: string;
  readonly planName: string;
  readonly startDate: string;
  readonly standing: Standing;
  readonly status: MembershipStatus;
  readonly userId: string;
  readonly version: number;
}
interface MembershipPage {
  readonly capabilities: { readonly canManageStates: boolean; readonly canWrite: boolean };
  readonly memberships: readonly Membership[];
}
interface PlanPage { readonly plans: readonly Plan[] }
interface ApiFailure { readonly message?: string }

const statusLabels: Readonly<Record<MembershipStatus, string>> = {
  ACTIVE: "Activa", CANCELLED: "Cancelada", EXPIRED: "Vencida", PENDING: "Pendiente", SUSPENDED: "Suspendida",
};
const standingLabels: Readonly<Record<Standing, string>> = {
  CURRENT: "Vigente", INACTIVE: "No vigente", OVERDUE: "En mora", UPCOMING: "Próxima",
};
const transitions: Readonly<Record<MembershipStatus, readonly MembershipStatus[]>> = {
  ACTIVE: ["ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"],
  CANCELLED: ["CANCELLED"],
  EXPIRED: ["EXPIRED"],
  PENDING: ["PENDING", "ACTIVE", "CANCELLED"],
  SUSPENDED: ["SUSPENDED", "ACTIVE", "EXPIRED", "CANCELLED"],
};
const parseFailure = async (response: Response): Promise<ApiFailure> => {
  try { return await response.json() as ApiFailure; } catch { return {}; }
};
const money = (amount: number): string => new Intl.NumberFormat("es-PY", {
  currency: "PYG", maximumFractionDigits: 0, style: "currency",
}).format(amount);

export function AdminMembershipsClient() {
  const [plans, setPlans] = useState<readonly Plan[]>([]);
  const [studentId, setStudentId] = useState("");
  const [page, setPage] = useState<MembershipPage>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/admin/plans?status=ACTIVE", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await parseFailure(response)).message ?? "No pudimos consultar los planes.");
        return response.json() as Promise<PlanPage>;
      })
      .then((result) => { if (active) setPlans(result.plans); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No pudimos consultar los planes."); });
    return () => { active = false; };
  }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/memberships?userId=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await parseFailure(response)).message ?? "No pudimos consultar las membresías.");
      setPage(await response.json() as MembershipPage);
    } catch (reason: unknown) {
      setPage(undefined);
      setError(reason instanceof Error ? reason.message : "No pudimos consultar las membresías.");
    } finally { setLoading(false); }
  }, []);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("studentId") ?? "").trim();
    setStudentId(value); setSuccess(""); void load(value);
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget; const data = new FormData(form);
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/v1/admin/memberships", {
        body: JSON.stringify({
          endDate: String(data.get("endDate")), expectedAmount: Number(data.get("expectedAmount")),
          planId: String(data.get("planId")), startDate: String(data.get("startDate")), userId: studentId,
        }),
        headers: { "content-type": "application/json" }, method: "POST",
      });
      if (!response.ok) throw new Error((await parseFailure(response)).message ?? "No pudimos crear la membresía.");
      form.reset(); setSuccess("Membresía pendiente creada correctamente."); await load(studentId);
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "No pudimos crear la membresía."); }
    finally { setBusy(false); }
  };

  const update = async (event: FormEvent<HTMLFormElement>, membership: Membership) => {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget); setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/v1/admin/memberships/${encodeURIComponent(membership.id)}`, {
        body: JSON.stringify({
          endDate: String(data.get("endDate")), expectedAmount: Number(data.get("expectedAmount")),
          expectedVersion: membership.version, reason: String(data.get("reason") ?? ""),
          startDate: membership.startDate, status: String(data.get("status") ?? membership.status), userId: membership.userId,
        }),
        headers: { "content-type": "application/json" }, method: "PATCH",
      });
      if (!response.ok) throw new Error((await parseFailure(response)).message ?? "No pudimos actualizar la membresía.");
      setSuccess("Membresía actualizada correctamente."); await load(studentId);
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "No pudimos actualizar la membresía."); }
    finally { setBusy(false); }
  };

  return <div>
    <header className="max-w-3xl">
      <p className="text-sm font-bold uppercase tracking-wide text-accent">Administración</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">Membresías</h1>
      <p className="mt-3 leading-7 text-muted">Consulta un alumno por su identificador y administra su vigencia sin alterar el historial.</p>
    </header>
    <form className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={search}>
      <div className="grow"><label className="block font-bold" htmlFor="membership-student">Identificador del alumno</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="membership-student" name="studentId" required /></div>
      <button className="min-h-11 rounded-lg bg-brand-900 px-6 font-bold text-white disabled:opacity-60" disabled={loading} type="submit">{loading ? "Consultando…" : "Consultar"}</button>
    </form>
    <p aria-live="polite" className="mt-5 font-semibold text-emerald-700">{success}</p>
    <p aria-live="assertive" className="mt-2 font-semibold text-red-700">{error}</p>
    {loading ? <p className="py-10 text-center" aria-live="polite">Cargando membresías…</p> : null}
    {page === undefined ? null : <>
      {page.capabilities.canWrite ? <form className="mt-8 grid gap-4 rounded-2xl border border-black/10 bg-surface p-5 sm:grid-cols-2" onSubmit={(event) => void create(event)}>
        <h2 className="text-2xl font-black sm:col-span-2">Crear membresía pendiente</h2>
        <div><label className="block font-bold" htmlFor="membership-plan">Plan activo</label><select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="membership-plan" name="planId" required onChange={(event) => { const plan = plans.find((entry) => entry.id === event.currentTarget.value); const amount = event.currentTarget.form?.elements.namedItem("expectedAmount"); if (plan !== undefined && amount instanceof HTMLInputElement) amount.value = String(plan.price); }}><option value="">Selecciona un plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {money(plan.price)}</option>)}</select></div>
        <div><label className="block font-bold" htmlFor="membership-amount">Importe esperado</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="membership-amount" min={1} name="expectedAmount" required step={1} type="number" /></div>
        <div><label className="block font-bold" htmlFor="membership-start">Inicio</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="membership-start" name="startDate" required type="date" /></div>
        <div><label className="block font-bold" htmlFor="membership-end">Vencimiento</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="membership-end" name="endDate" required type="date" /></div>
        <button className="min-h-11 rounded-lg bg-accent px-6 font-bold text-brand-900 disabled:opacity-60 sm:col-span-2" disabled={busy || plans.length === 0} type="submit">{busy ? "Guardando…" : "Crear membresía"}</button>
      </form> : null}
      {page.memberships.length === 0 ? <section className="mt-8 rounded-2xl border border-dashed border-slate-400 p-8 text-center"><h2 className="text-xl font-black">Sin membresías</h2><p className="mt-2 text-muted">Este alumno todavía no tiene historial de membresías.</p></section> : <section className="mt-8" aria-labelledby="membership-history"><h2 className="text-2xl font-black" id="membership-history">Historial</h2><ul className="mt-5 grid gap-4 xl:grid-cols-2">{page.memberships.map((membership) => <li className="rounded-2xl border border-black/10 bg-surface p-5" key={membership.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-black">{membership.planName}</h3><p className="mt-1">{membership.startDate} a {membership.endDate} · {money(membership.expectedAmount)}</p></div><span className="rounded-full bg-canvas px-3 py-1 text-sm font-bold">{statusLabels[membership.status]} · {standingLabels[membership.standing]}</span></div>
        <form className="mt-5 grid gap-3 rounded-xl bg-canvas p-4 sm:grid-cols-2" onSubmit={(event) => void update(event, membership)}>
          <div><label className="block font-bold" htmlFor={`end-${membership.id}`}>Vencimiento</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={membership.endDate} id={`end-${membership.id}`} min={membership.startDate} name="endDate" required type="date" /></div>
          <div><label className="block font-bold" htmlFor={`amount-${membership.id}`}>Importe esperado</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={membership.expectedAmount} id={`amount-${membership.id}`} min={1} name="expectedAmount" required step={1} type="number" /></div>
          {page.capabilities.canManageStates ? <div><label className="block font-bold" htmlFor={`status-${membership.id}`}>Estado</label><select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={membership.status} id={`status-${membership.id}`} name="status">{transitions[membership.status].map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></div> : <input name="status" type="hidden" value={membership.status} />}
          <div><label className="block font-bold" htmlFor={`reason-${membership.id}`}>Motivo del cambio de estado</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id={`reason-${membership.id}`} maxLength={500} name="reason" /></div>
          <button className="min-h-11 rounded-lg bg-brand-900 px-5 font-bold text-white disabled:opacity-60 sm:col-span-2" disabled={busy || membership.status === "CANCELLED" || membership.status === "EXPIRED"} type="submit">{busy ? "Guardando…" : "Guardar cambios"}</button>
        </form>
      </li>)}</ul></section>}
    </>}
  </div>;
}
