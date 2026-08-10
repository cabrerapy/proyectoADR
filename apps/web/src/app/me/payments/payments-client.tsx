"use client";

import { useCallback, useEffect, useState } from "react";

interface Payment { readonly amount: number; readonly currency: string; readonly hasReceipt: boolean; readonly id: string; readonly method: string; readonly paidAt: string; readonly periodEnd: string; readonly periodStart: string; readonly status: string }
interface PaymentPage { readonly cursor?: string; readonly payments: readonly Payment[] }
interface ApiFailure { readonly message?: string }
const money = (value: number): string => new Intl.NumberFormat("es-PY", { currency: "PYG", maximumFractionDigits: 0, style: "currency" }).format(value);
const failure = async (response: Response): Promise<string> => { try { return ((await response.json()) as ApiFailure).message ?? "No pudimos consultar tus pagos."; } catch { return "No pudimos consultar tus pagos."; } };

export function OwnPaymentsClient() {
  const [page, setPage] = useState<PaymentPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (cursor?: string) => {
    setLoading(true); setError("");
    try {
      const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(`/api/v1/me/payments${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await failure(response));
      const result = await response.json() as PaymentPage;
      setPage((current) => cursor === undefined ? result : { ...result, payments: [...(current?.payments ?? []), ...result.payments] });
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "No pudimos consultar tus pagos."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const openReceipt = async (payment: Payment) => {
    setError("");
    const params = new URLSearchParams({ paidAt: payment.paidAt, paymentId: payment.id });
    const response = await fetch(`/api/v1/me/payment-receipt?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) { setError(await failure(response)); return; }
    const { url } = await response.json() as { readonly url: string };
    window.location.assign(url);
  };
  return <div><header><p className="text-sm font-bold uppercase tracking-wide text-accent">Portal del alumno</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Mis pagos</h1><p className="mt-3 text-muted">Consulta exclusivamente tu historial de pagos y abre comprobantes privados mediante enlaces temporales.</p></header>
    <p aria-live="assertive" className="mt-6 font-semibold text-red-700">{error}</p>
    {loading && page === undefined ? <p className="py-16 text-center">Cargando tus pagos…</p> : null}
    {page?.payments.length === 0 ? <section className="mt-8 rounded-2xl border border-dashed border-slate-400 p-8 text-center"><h2 className="text-xl font-black">Sin pagos</h2><p className="mt-2 text-muted">Todavía no tienes pagos registrados.</p></section> : null}
    {page === undefined || page.payments.length === 0 ? null : <section className="mt-8"><h2 className="text-2xl font-black">Historial</h2><ul className="mt-5 grid gap-4 md:grid-cols-2">{page.payments.map((payment) => <li className="rounded-2xl border border-black/10 bg-surface p-5" key={payment.id}><div className="flex justify-between gap-3"><strong className="text-xl">{money(payment.amount)}</strong><span className="font-bold">{payment.status}</span></div><p className="mt-3">{new Date(payment.paidAt).toLocaleString("es-PY", { timeZone: "America/Asuncion" })}</p><p className="mt-1 text-sm text-muted">Periodo: {payment.periodStart} a {payment.periodEnd}</p>{payment.hasReceipt ? <button className="mt-4 min-h-11 rounded-lg border border-brand-900 px-4 font-bold text-brand-900" onClick={() => void openReceipt(payment)} type="button">Abrir comprobante</button> : <p className="mt-4 text-sm text-muted">Sin comprobante</p>}</li>)}</ul>{page.cursor === undefined ? null : <button className="mt-6 min-h-11 rounded-lg bg-brand-900 px-6 font-bold text-white disabled:opacity-60" disabled={loading} onClick={() => void load(page.cursor)} type="button">{loading ? "Cargando…" : "Cargar más"}</button>}</section>}
  </div>;
}
