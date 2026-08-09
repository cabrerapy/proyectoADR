"use client";

import { useCallback, useEffect, useState } from "react";

type MembershipStatus = "PENDING" | "ACTIVE" | "EXPIRED" | "SUSPENDED" | "CANCELLED";
type Standing = "UPCOMING" | "CURRENT" | "OVERDUE" | "INACTIVE";
interface Membership {
  readonly currency: string;
  readonly endDate: string;
  readonly expectedAmount: number;
  readonly id: string;
  readonly planName: string;
  readonly startDate: string;
  readonly standing: Standing;
  readonly status: MembershipStatus;
}
interface MembershipPage {
  readonly active?: Membership;
  readonly cursor?: string;
  readonly history: readonly Membership[];
}
interface ApiFailure { readonly message?: string }

const statusLabels: Readonly<Record<MembershipStatus, string>> = {
  ACTIVE: "Activa", CANCELLED: "Cancelada", EXPIRED: "Vencida", PENDING: "Pendiente", SUSPENDED: "Suspendida",
};
const standingLabels: Readonly<Record<Standing, string>> = {
  CURRENT: "Vigente", INACTIVE: "No vigente", OVERDUE: "En mora", UPCOMING: "Próxima",
};
const money = (amount: number): string => new Intl.NumberFormat("es-PY", {
  currency: "PYG", maximumFractionDigits: 0, style: "currency",
}).format(amount);
const date = (value: string): string => new Intl.DateTimeFormat("es-PY", {
  day: "2-digit", month: "long", timeZone: "America/Asuncion", year: "numeric",
}).format(new Date(`${value}T12:00:00.000Z`));
const parseFailure = async (response: Response): Promise<ApiFailure> => {
  try { return await response.json() as ApiFailure; } catch { return {}; }
};

export function OwnMembershipClient() {
  const [page, setPage] = useState<MembershipPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (cursor?: string) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (cursor !== undefined) params.set("cursor", cursor);
      const response = await fetch(`/api/v1/me/membership${params.size === 0 ? "" : `?${params.toString()}`}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await parseFailure(response)).message ?? "No pudimos consultar tu membresía.");
      const result = await response.json() as MembershipPage;
      setPage((current) => {
        if (cursor === undefined) return result;
        const active = result.active ?? current?.active;
        return {
          ...result,
          ...(active === undefined ? {} : { active }),
          history: [...(current?.history ?? []), ...result.history],
        };
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "No pudimos consultar tu membresía.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  return <div>
    <header className="max-w-3xl">
      <p className="text-sm font-bold uppercase tracking-wide text-accent">Portal del alumno</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">Mi membresía</h1>
      <p className="mt-3 leading-7 text-muted">Consulta tu plan, vigencia y vencimiento. Estos datos solo pueden ser modificados por el gimnasio.</p>
    </header>
    <p aria-live="assertive" className="mt-6 font-semibold text-red-700">{error}</p>
    {loading && page === undefined ? <p aria-live="polite" className="py-16 text-center text-lg">Cargando tu membresía…</p> : null}
    {page === undefined ? null : <>
      {page.active === undefined ? <section className="mt-8 rounded-2xl border border-dashed border-slate-400 p-8 text-center" aria-labelledby="no-active-membership"><h2 className="text-xl font-black" id="no-active-membership">No tienes una membresía activa</h2><p className="mt-2 text-muted">Si ya realizaste el pago, consulta con administración.</p></section> : <MembershipCard membership={page.active} title="Membresía actual" />}
      <section className="mt-10" aria-labelledby="own-membership-history"><h2 className="text-2xl font-black" id="own-membership-history">Historial</h2>
        {page.history.length === 0 ? <p className="mt-4 rounded-xl bg-canvas p-6 text-muted">Todavía no hay membresías registradas.</p> : <ul className="mt-5 grid gap-4 md:grid-cols-2">{page.history.map((membership) => <li key={membership.id}><MembershipCard membership={membership} /></li>)}</ul>}
        {page.cursor === undefined ? null : <button className="mt-6 min-h-11 rounded-lg border border-brand-900 px-6 font-bold text-brand-900 disabled:opacity-60" disabled={loading} onClick={() => void load(page.cursor)} type="button">{loading ? "Cargando…" : "Cargar más"}</button>}
      </section>
    </>}
  </div>;
}

function MembershipCard({ membership, title }: { readonly membership: Membership; readonly title?: string }) {
  return <article className="h-full rounded-2xl border border-black/10 bg-surface p-5 shadow-sm">
    {title === undefined ? null : <h2 className="text-xl font-black">{title}</h2>}
    <h3 className={`${title === undefined ? "" : "mt-3 "}text-lg font-black`}>{membership.planName}</h3>
    <p className="mt-2 font-bold">{statusLabels[membership.status]} · {standingLabels[membership.standing]}</p>
    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="font-bold">Inicio</dt><dd>{date(membership.startDate)}</dd></div><div><dt className="font-bold">Vencimiento</dt><dd>{date(membership.endDate)}</dd></div><div className="col-span-2"><dt className="font-bold">Importe esperado</dt><dd>{money(membership.expectedAmount)}</dd></div></dl>
  </article>;
}
