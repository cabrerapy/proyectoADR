"use client";

import { useRef, useState, type FormEvent } from "react";

interface Membership { readonly endDate: string; readonly id: string; readonly planName: string; readonly startDate: string; readonly status: string; readonly userId: string }
interface MembershipPage { readonly memberships: readonly Membership[] }
interface UploadIntent { readonly headers: Readonly<Record<string, string>>; readonly key: string; readonly uploadUrl: string }
interface ApiFailure { readonly message?: string }
interface PaymentView { readonly amount: number; readonly id: string; readonly paidAt: string; readonly status: string; readonly userId: string }
interface PaymentQueryPage { readonly cursor?: string; readonly payments: readonly PaymentView[] }

const failure = async (response: Response, fallback: string): Promise<Error> => {
  try { return new Error(((await response.json()) as ApiFailure).message ?? fallback); } catch { return new Error(fallback); }
};

export function AdminPaymentsClient() {
  const [studentId, setStudentId] = useState("");
  const [memberships, setMemberships] = useState<readonly Membership[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const requestKey = useRef<string | undefined>(undefined);
  const uploadedReceipt = useRef<{ readonly fingerprint: string; readonly key: string } | undefined>(undefined);

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = String(new FormData(event.currentTarget).get("studentId") ?? "").trim();
    setLoading(true); setError(""); setSuccess(""); setStudentId(id); setSearched(true);
    try {
      const response = await fetch(`/api/v1/admin/memberships?userId=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw await failure(response, "No pudimos consultar las membresías.");
      setMemberships((await response.json() as MembershipPage).memberships);
    } catch (reason: unknown) {
      setMemberships([]); setError(reason instanceof Error ? reason.message : "No pudimos consultar las membresías.");
    } finally { setLoading(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget; const data = new FormData(form);
    const membership = memberships.find((entry) => entry.id === String(data.get("membershipId")));
    if (membership === undefined) { setError("Selecciona una membresía válida."); return; }
    setBusy(true); setError(""); setSuccess(""); requestKey.current ??= crypto.randomUUID();
    const idempotencyKey = requestKey.current;
    try {
      const receipt = data.get("receipt");
      let receiptKey: string | undefined;
      if (receipt instanceof File && receipt.size > 0) {
        const fingerprint = `${receipt.name}\0${receipt.type}\0${receipt.size}\0${receipt.lastModified}`;
        if (uploadedReceipt.current?.fingerprint === fingerprint) {
          receiptKey = uploadedReceipt.current.key;
        } else {
          const intentResponse = await fetch("/api/v1/admin/payment-receipts", {
            body: JSON.stringify({ contentType: receipt.type, fileName: receipt.name, size: receipt.size }),
            headers: { "content-type": "application/json" }, method: "POST",
          });
          if (!intentResponse.ok) throw await failure(intentResponse, "No pudimos preparar el comprobante.");
          const intent = await intentResponse.json() as UploadIntent;
          const upload = await fetch(intent.uploadUrl, { body: receipt, headers: intent.headers, method: "PUT" });
          if (!upload.ok) throw await failure(upload, "No pudimos cargar el comprobante.");
          receiptKey = intent.key;
          uploadedReceipt.current = { fingerprint, key: intent.key };
        }
      }
      const paidAt = new Date(String(data.get("paidAt"))).toISOString();
      const response = await fetch("/api/v1/admin/payments", {
        body: JSON.stringify({
          amount: Number(data.get("amount")), membershipId: membership.id, membershipStartDate: membership.startDate,
          method: String(data.get("method")), notes: String(data.get("notes") ?? ""), paidAt,
          periodEnd: String(data.get("periodEnd")), periodStart: String(data.get("periodStart")),
          ...(receiptKey === undefined ? {} : { receiptKey }), status: String(data.get("status")), userId: studentId,
        }),
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, method: "POST",
      });
      if (!response.ok) throw await failure(response, "No pudimos registrar el pago.");
      const result = await response.json() as { readonly disposition: "CREATED" | "REPLAYED" };
      setSuccess(result.disposition === "REPLAYED" ? "El pago ya estaba registrado; mostramos el mismo resultado." : "Pago registrado correctamente.");
      requestKey.current = undefined; uploadedReceipt.current = undefined; form.reset();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "No pudimos registrar el pago.");
    } finally { setBusy(false); }
  };

  return <div>
    <header><p className="text-sm font-bold uppercase tracking-wide text-accent">Administración</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Registrar pago</h1><p className="mt-3 max-w-3xl leading-7 text-muted">Registra un pago manual asociado a una membresía. El comprobante es opcional y permanece privado.</p></header>
    <PaymentReports />
    <form className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => void search(event)}>
      <div className="grow"><label className="block font-bold" htmlFor="payment-student">Identificador del alumno</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="payment-student" name="studentId" required /></div>
      <button className="min-h-11 rounded-lg bg-brand-900 px-6 font-bold text-white disabled:opacity-60" disabled={loading} type="submit">{loading ? "Consultando…" : "Consultar"}</button>
    </form>
    <p aria-live="assertive" className="mt-4 font-semibold text-red-700">{error}</p><p aria-live="polite" className="mt-2 font-semibold text-emerald-700">{success}</p>
    {loading ? <p className="py-10 text-center">Cargando membresías…</p> : null}
    {searched && !loading && memberships.length === 0 ? <section className="mt-8 rounded-2xl border border-dashed border-slate-400 p-8 text-center"><h2 className="text-xl font-black">Sin membresías</h2><p className="mt-2 text-muted">No hay una membresía disponible para asociar al pago.</p></section> : null}
    {memberships.length > 0 ? <form className="mt-8 grid gap-4 rounded-2xl border border-black/10 bg-surface p-5 sm:grid-cols-2" onChange={() => { requestKey.current = undefined; uploadedReceipt.current = undefined; }} onSubmit={(event) => void submit(event)}>
      <h2 className="text-2xl font-black sm:col-span-2">Datos del pago</h2>
      <div className="sm:col-span-2"><label className="block font-bold" htmlFor="payment-membership">Membresía</label><select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="payment-membership" name="membershipId" required><option value="">Selecciona una membresía</option>{memberships.map((entry) => <option key={entry.id} value={entry.id}>{entry.planName} · {entry.startDate} a {entry.endDate} · {entry.status}</option>)}</select></div>
      <div><label className="block font-bold" htmlFor="payment-amount">Importe PYG</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="payment-amount" min={1} name="amount" required step={1} type="number" /></div>
      <div><label className="block font-bold" htmlFor="payment-method">Método</label><select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="payment-method" name="method" required><option value="CASH">Efectivo</option><option value="BANK_TRANSFER">Transferencia</option><option value="MANUAL_CARD">Tarjeta manual</option><option value="OTHER">Otro</option></select></div>
      <div><label className="block font-bold" htmlFor="payment-paid-at">Fecha y hora</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="payment-paid-at" name="paidAt" required type="datetime-local" /></div>
      <div><label className="block font-bold" htmlFor="payment-status">Estado</label><select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="payment-status" name="status"><option value="CONFIRMED">Confirmado</option><option value="PENDING">Pendiente</option></select></div>
      <div><label className="block font-bold" htmlFor="payment-period-start">Periodo desde</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="payment-period-start" name="periodStart" required type="date" /></div>
      <div><label className="block font-bold" htmlFor="payment-period-end">Periodo hasta</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="payment-period-end" name="periodEnd" required type="date" /></div>
      <div className="sm:col-span-2"><label className="block font-bold" htmlFor="payment-receipt">Comprobante privado (opcional)</label><input accept="application/pdf,image/jpeg,image/png" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-400 p-2" id="payment-receipt" name="receipt" type="file" /><p className="mt-1 text-sm text-muted">PDF, JPG o PNG; máximo 5 MB.</p></div>
      <div className="sm:col-span-2"><label className="block font-bold" htmlFor="payment-notes">Observaciones</label><textarea className="mt-2 min-h-24 w-full rounded-lg border border-slate-400 p-3" id="payment-notes" maxLength={500} name="notes" /></div>
      <button className="min-h-11 rounded-lg bg-accent px-6 font-bold text-brand-900 disabled:opacity-60 sm:col-span-2" disabled={busy} type="submit">{busy ? "Registrando…" : "Registrar pago"}</button>
    </form> : null}
  </div>;
}

function PaymentReports() {
  const [page, setPage] = useState<PaymentQueryPage>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = async (value: string, cursor?: string) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams(value);
      if (cursor !== undefined) params.set("cursor", cursor);
      const response = await fetch(`/api/v1/admin/payments?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw await failure(response, "No pudimos consultar los pagos.");
      const result = await response.json() as PaymentQueryPage;
      setPage((current) => cursor === undefined ? result : { ...result, payments: [...(current?.payments ?? []), ...result.payments] });
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "No pudimos consultar los pagos."); }
    finally { setLoading(false); }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const filter = String(data.get("filter"));
    const value = filter === "date" ? String(data.get("date")) : String(data.get("status"));
    const next = new URLSearchParams({ filter, value }).toString();
    setQuery(next); void load(next);
  };
  return <section className="mt-10 border-b border-black/10 pb-10" aria-labelledby="payment-reports-title"><h2 className="text-2xl font-black" id="payment-reports-title">Consultar pagos</h2><form className="mt-5 grid gap-4 sm:grid-cols-3" onSubmit={submit}><div><label className="block font-bold" htmlFor="payment-filter">Filtro</label><select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="payment-filter" name="filter"><option value="date">Fecha</option><option value="status">Estado</option></select></div><div><label className="block font-bold" htmlFor="payment-report-date">Fecha</label><input className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="payment-report-date" name="date" type="date" /></div><div><label className="block font-bold" htmlFor="payment-report-status">Estado</label><select className="mt-2 min-h-11 w-full rounded-lg border border-slate-400 px-3" id="payment-report-status" name="status"><option value="CONFIRMED">Confirmado</option><option value="PENDING">Pendiente</option><option value="VOIDED">Anulado</option></select></div><button className="min-h-11 rounded-lg border border-brand-900 px-5 font-bold text-brand-900 disabled:opacity-60 sm:col-span-3" disabled={loading} type="submit">{loading ? "Consultando…" : "Consultar pagos"}</button></form><p aria-live="assertive" className="mt-4 font-semibold text-red-700">{error}</p>{page?.payments.length === 0 ? <p className="mt-5 rounded-xl bg-canvas p-5 text-muted">No hay pagos para el filtro seleccionado.</p> : null}{page === undefined || page.payments.length === 0 ? null : <><ul className="mt-5 grid gap-3 md:grid-cols-2">{page.payments.map((payment) => <li className="rounded-xl bg-canvas p-4" key={`${payment.userId}-${payment.id}`}><strong>{new Intl.NumberFormat("es-PY", { currency: "PYG", maximumFractionDigits: 0, style: "currency" }).format(payment.amount)}</strong><p className="mt-1 text-sm">Alumno: {payment.userId}</p><p className="text-sm">{payment.status} · {new Date(payment.paidAt).toLocaleString("es-PY", { timeZone: "America/Asuncion" })}</p></li>)}</ul>{page.cursor === undefined ? null : <button className="mt-5 min-h-11 rounded-lg border border-brand-900 px-5 font-bold text-brand-900 disabled:opacity-60" disabled={loading} onClick={() => void load(query, page.cursor)} type="button">{loading ? "Cargando…" : "Cargar más"}</button>}</>}</section>;
}
