"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Frequency = "MONTHLY" | "QUARTERLY" | "ANNUAL" | "CUSTOM";
type PlanStatus = "ACTIVE" | "INACTIVE";

interface Plan {
  readonly currency: "PYG";
  readonly description?: string;
  readonly frequency: Frequency;
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly status: PlanStatus;
  readonly version: number;
}

interface PlanPage {
  readonly capabilities: { readonly canManage: boolean };
  readonly cursor?: string;
  readonly plans: readonly Plan[];
}

interface ApiFailure { readonly message?: string }

const frequencyLabels: Readonly<Record<Frequency, string>> = {
  ANNUAL: "Anual",
  CUSTOM: "Personalizada",
  MONTHLY: "Mensual",
  QUARTERLY: "Trimestral",
};
const statusLabels: Readonly<Record<PlanStatus, string>> = { ACTIVE: "Activo", INACTIVE: "Inactivo" };
const parseFailure = async (response: Response): Promise<ApiFailure> => {
  try { return await response.json() as ApiFailure; } catch { return {}; }
};
const formatMoney = (value: number): string => new Intl.NumberFormat("es-PY", {
  currency: "PYG",
  maximumFractionDigits: 0,
  style: "currency",
}).format(value);
const commandFromForm = (form: FormData) => ({
  currency: "PYG" as const,
  description: String(form.get("description") ?? ""),
  frequency: String(form.get("frequency") ?? "MONTHLY") as Frequency,
  name: String(form.get("name") ?? ""),
  price: Number(form.get("price")),
});

export function AdminPlansClient() {
  const [status, setStatus] = useState<PlanStatus | "ALL">("ALL");
  const [page, setPage] = useState<PlanPage>();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [loadError, setLoadError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async (requestedStatus: PlanStatus | "ALL", cursor?: string) => {
    setLoading(true);
    setLoadError("");
    const params = new URLSearchParams({ status: requestedStatus });
    if (cursor !== undefined) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/v1/admin/plans?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await parseFailure(response)).message ?? "No pudimos consultar los planes.");
      const result = await response.json() as PlanPage;
      setPage((current) => cursor === undefined
        ? result
        : { ...result, plans: [...(current?.plans ?? []), ...result.plans] });
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : "No pudimos consultar los planes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load("ALL"), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyId !== undefined) return;
    const form = event.currentTarget;
    setBusyId("new");
    setMutationError("");
    setSuccess("");
    try {
      const response = await fetch("/api/v1/admin/plans", {
        body: JSON.stringify(commandFromForm(new FormData(form))),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error((await parseFailure(response)).message ?? "No pudimos crear el plan.");
      form.reset();
      setSuccess("Plan creado correctamente.");
      await load(status);
    } catch (error: unknown) {
      setMutationError(error instanceof Error ? error.message : "No pudimos crear el plan.");
    } finally {
      setBusyId(undefined);
    }
  };

  const update = async (event: FormEvent<HTMLFormElement>, plan: Plan) => {
    event.preventDefault();
    if (busyId !== undefined) return;
    setBusyId(plan.id);
    setMutationError("");
    setSuccess("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/v1/admin/plans/${encodeURIComponent(plan.id)}`, {
        body: JSON.stringify({
          ...commandFromForm(form),
          expectedVersion: plan.version,
          status: String(form.get("status") ?? plan.status),
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) throw new Error((await parseFailure(response)).message ?? "No pudimos actualizar el plan.");
      const updated = await response.json() as Plan;
      setPage((current) => current === undefined ? current : {
        ...current,
        plans: current.plans.map((entry) => entry.id === updated.id ? updated : entry)
          .filter((entry) => status === "ALL" || entry.status === status),
      });
      setSuccess(`${updated.name}: cambios guardados.`);
    } catch (error: unknown) {
      setMutationError(error instanceof Error ? error.message : "No pudimos actualizar el plan.");
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <div>
      <header className="max-w-3xl">
        <p className="text-sm font-bold uppercase tracking-wide text-accent">Administración</p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">Planes de membresía</h1>
        <p className="mt-3 leading-7 text-muted">Los cambios futuros no alteran las membresías históricas ya creadas.</p>
      </header>

      <div className="mt-8 flex flex-wrap items-end gap-3">
        <div>
          <label className="block font-bold" htmlFor="plan-status-filter">Mostrar</label>
          <select className="mt-2 min-h-11 rounded-lg border border-slate-400 px-3" id="plan-status-filter" value={status} onChange={(event) => setStatus(event.currentTarget.value as PlanStatus | "ALL")}>
            <option value="ALL">Todos</option><option value="ACTIVE">Activos</option><option value="INACTIVE">Inactivos</option>
          </select>
        </div>
        <button className="min-h-11 rounded-lg border border-brand-900 px-5 font-bold text-brand-900 disabled:opacity-60" disabled={loading} onClick={() => void load(status)} type="button">{loading ? "Cargando…" : "Aplicar filtro"}</button>
      </div>

      {page?.capabilities.canManage ? (
        <form className="mt-8 grid gap-4 rounded-2xl border border-black/10 bg-surface p-5 sm:grid-cols-2" onSubmit={(event) => void create(event)}>
          <h2 className="text-2xl font-black sm:col-span-2">Crear plan</h2>
          <PlanFields prefix="new" />
          <button className="min-h-11 rounded-lg bg-brand-900 px-6 font-bold text-white disabled:cursor-wait disabled:opacity-60 sm:col-span-2" disabled={busyId !== undefined} type="submit">{busyId === "new" ? "Creando…" : "Crear plan"}</button>
        </form>
      ) : null}

      <p aria-live="polite" className="mt-5 font-semibold text-emerald-700">{success}</p>
      <p aria-live="assertive" className="mt-2 font-semibold text-red-700">{mutationError || loadError}</p>

      {loading && page === undefined ? (
        <p aria-live="polite" className="py-16 text-center text-lg">Cargando planes…</p>
      ) : page === undefined || page.plans.length === 0 ? (
        <section className="mt-8 rounded-2xl border border-dashed border-slate-400 p-8 text-center" aria-labelledby="empty-plans-title">
          <h2 className="text-xl font-black" id="empty-plans-title">No hay planes</h2>
          <p className="mt-2 text-muted">Crea el primer plan o cambia el filtro seleccionado.</p>
        </section>
      ) : (
        <section className="mt-8" aria-labelledby="plan-results-title">
          <h2 className="text-2xl font-black" id="plan-results-title">Planes registrados</h2>
          <ul className="mt-5 grid gap-4 xl:grid-cols-2">
            {page.plans.map((plan) => (
              <li className="rounded-2xl border border-black/10 bg-surface p-5 shadow-sm" key={plan.id}>
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="text-xl font-black">{plan.name}</h3><p className="mt-1 text-lg font-bold">{formatMoney(plan.price)} · {frequencyLabels[plan.frequency]}</p></div>
                  <span className="rounded-full bg-canvas px-3 py-1 text-sm font-bold">{statusLabels[plan.status]}</span>
                </div>
                {plan.description === undefined ? null : <p className="mt-3 text-muted">{plan.description}</p>}
                {page.capabilities.canManage ? (
                  <form className="mt-5 grid gap-3 rounded-xl bg-canvas p-4 sm:grid-cols-2" onSubmit={(event) => void update(event, plan)}>
                    <PlanFields plan={plan} prefix={plan.id} />
                    <div><label className="block font-bold" htmlFor={`status-${plan.id}`}>Estado</label><select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={plan.status} id={`status-${plan.id}`} name="status"><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo (baja lógica)</option></select></div>
                    <button className="min-h-11 rounded-lg bg-accent px-5 font-bold text-brand-900 disabled:cursor-wait disabled:opacity-60 sm:self-end" disabled={busyId !== undefined} type="submit">{busyId === plan.id ? "Guardando…" : "Guardar cambios"}</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          {page.cursor === undefined ? null : <button className="mt-6 min-h-11 rounded-lg border border-brand-900 px-6 font-bold text-brand-900 disabled:opacity-60" disabled={loading} onClick={() => void load(status, page.cursor)} type="button">{loading ? "Cargando…" : "Cargar más"}</button>}
        </section>
      )}
    </div>
  );
}

function PlanFields({ plan, prefix }: { readonly plan?: Plan; readonly prefix: string }) {
  return <>
    <div><label className="block font-bold" htmlFor={`name-${prefix}`}>Nombre</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={plan?.name} id={`name-${prefix}`} maxLength={120} minLength={2} name="name" required /></div>
    <div><label className="block font-bold" htmlFor={`price-${prefix}`}>Precio en guaraníes</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={plan?.price} id={`price-${prefix}`} min={1} name="price" required step={1} type="number" /></div>
    <div><label className="block font-bold" htmlFor={`frequency-${prefix}`}>Frecuencia</label><select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" defaultValue={plan?.frequency ?? "MONTHLY"} id={`frequency-${prefix}`} name="frequency">{Object.entries(frequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    <div className="sm:col-span-2"><label className="block font-bold" htmlFor={`description-${prefix}`}>Descripción opcional</label><textarea className="mt-2 min-h-24 w-full rounded-lg border border-slate-400 p-3" defaultValue={plan?.description} id={`description-${prefix}`} maxLength={500} name="description" /></div>
  </>;
}
