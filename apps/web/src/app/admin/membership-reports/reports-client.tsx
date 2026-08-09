"use client";

import { useState, type FormEvent } from "react";

type Filter = "due" | "status";
type MembershipStatus = "PENDING" | "ACTIVE" | "EXPIRED" | "SUSPENDED" | "CANCELLED";
type Standing = "UPCOMING" | "CURRENT" | "OVERDUE" | "INACTIVE";
interface Membership {
  readonly endDate: string;
  readonly expectedAmount: number;
  readonly id: string;
  readonly planName: string;
  readonly standing: Standing;
  readonly startDate: string;
  readonly status: MembershipStatus;
  readonly userId: string;
}
interface ReportPage { readonly cursor?: string; readonly memberships: readonly Membership[] }
interface ApiFailure { readonly message?: string }
interface Selection { readonly filter: Filter; readonly value: string }

const statusLabels: Readonly<Record<MembershipStatus, string>> = {
  ACTIVE: "Activa", CANCELLED: "Cancelada", EXPIRED: "Vencida", PENDING: "Pendiente", SUSPENDED: "Suspendida",
};
const standingLabels: Readonly<Record<Standing, string>> = {
  CURRENT: "Vigente", INACTIVE: "No vigente", OVERDUE: "En mora", UPCOMING: "Próxima",
};
const parseFailure = async (response: Response): Promise<ApiFailure> => {
  try { return await response.json() as ApiFailure; } catch { return {}; }
};

export function MembershipReportsClient() {
  const [filter, setFilter] = useState<Filter>("due");
  const [selection, setSelection] = useState<Selection>();
  const [page, setPage] = useState<ReportPage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (requested: Selection, cursor?: string) => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ filter: requested.filter, value: requested.value });
    if (cursor !== undefined) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/v1/admin/membership-reports?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await parseFailure(response)).message ?? "No pudimos consultar el reporte.");
      const result = await response.json() as ReportPage;
      setPage((current) => cursor === undefined ? result : {
        ...result,
        memberships: [...(current?.memberships ?? []), ...result.memberships],
      });
    } catch (reason: unknown) {
      if (cursor === undefined) setPage(undefined);
      setError(reason instanceof Error ? reason.message : "No pudimos consultar el reporte.");
    } finally { setLoading(false); }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const requested = { filter, value: String(form.get("value") ?? "") };
    setSelection(requested); void load(requested);
  };

  return <div>
    <header className="max-w-3xl"><p className="text-sm font-bold uppercase tracking-wide text-accent">Administración</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Reportes de membresías</h1><p className="mt-3 leading-7 text-muted">Consulta vencimientos exactos o estados. Cada resultado se revalida contra su registro vigente.</p></header>
    <form className="mt-8 grid gap-4 rounded-2xl border border-black/10 bg-surface p-5 sm:grid-cols-3 sm:items-end" onSubmit={submit}>
      <div><label className="block font-bold" htmlFor="report-filter">Reporte</label><select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="report-filter" value={filter} onChange={(event) => setFilter(event.currentTarget.value as Filter)}><option value="due">Vencimiento en fecha</option><option value="status">Estado</option></select></div>
      {filter === "due" ? <div><label className="block font-bold" htmlFor="report-value">Fecha de vencimiento</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="report-value" name="value" required type="date" /></div> : <div><label className="block font-bold" htmlFor="report-value">Estado</label><select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="report-value" name="value"><option value="ACTIVE">Activa</option><option value="PENDING">Pendiente</option><option value="SUSPENDED">Suspendida</option><option value="EXPIRED">Vencida</option><option value="CANCELLED">Cancelada</option></select></div>}
      <button className="min-h-11 rounded-lg bg-brand-900 px-6 font-bold text-white disabled:opacity-60" disabled={loading} type="submit">{loading ? "Consultando…" : "Consultar reporte"}</button>
    </form>
    <p aria-live="assertive" className="mt-5 font-semibold text-red-700">{error}</p>
    {loading && page === undefined ? <p aria-live="polite" className="py-12 text-center">Cargando reporte…</p> : null}
    {page === undefined ? null : page.memberships.length === 0 ? <section className="mt-8 rounded-2xl border border-dashed border-slate-400 p-8 text-center"><h2 className="text-xl font-black">Sin resultados</h2><p className="mt-2 text-muted">No existen membresías para el criterio seleccionado.</p></section> : <section className="mt-8" aria-labelledby="membership-report-results"><h2 className="text-2xl font-black" id="membership-report-results">Resultados</h2><ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{page.memberships.map((membership) => <li className="rounded-2xl border border-black/10 bg-surface p-5 shadow-sm" key={`${membership.userId}-${membership.id}`}><h3 className="text-lg font-black">{membership.planName}</h3><p className="mt-2 font-bold">{statusLabels[membership.status]} · {standingLabels[membership.standing]}</p><dl className="mt-4 grid gap-2 text-sm"><div><dt className="font-bold">Alumno</dt><dd className="break-all">{membership.userId}</dd></div><div><dt className="font-bold">Periodo</dt><dd>{membership.startDate} a {membership.endDate}</dd></div></dl></li>)}</ul>{page.cursor === undefined || selection === undefined ? null : <button className="mt-6 min-h-11 rounded-lg border border-brand-900 px-6 font-bold text-brand-900 disabled:opacity-60" disabled={loading} onClick={() => void load(selection, page.cursor)} type="button">{loading ? "Cargando…" : "Cargar más"}</button>}</section>}
  </div>;
}
