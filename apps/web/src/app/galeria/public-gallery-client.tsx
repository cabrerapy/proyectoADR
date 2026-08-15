"use client";

import { useEffect, useState } from "react";

interface PublicAsset { readonly assetId: string; readonly publicObjectKey: string; readonly publishedAt: string }

export function PublicGalleryClient() {
  const [assets, setAssets] = useState<readonly PublicAsset[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    const date = new Date();
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    void fetch(`/api/v1/gallery?month=${month}`).then(async (response) => {
      if (!response.ok) throw new Error("No pudimos cargar la galería.");
      const payload = await response.json() as { readonly assets: readonly PublicAsset[] };
      setAssets(payload.assets);
    }).catch(() => setError("No pudimos cargar la galería. Intenta nuevamente."));
  }, []);
  return <section aria-busy={assets === undefined && error === ""} aria-labelledby="gallery-title" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8"><h2 className="sr-only" id="gallery-title">Fotografías publicadas</h2>{error !== "" ? <p className="rounded-xl border border-red-300 bg-red-50 p-6 text-center text-red-800" role="alert">{error}</p> : assets === undefined ? <p className="py-12 text-center" aria-live="polite">Cargando fotografías…</p> : assets.length === 0 ? <div className="rounded-2xl border border-dashed border-brand-700/40 bg-surface px-6 py-14 text-center"><h2 className="text-2xl font-black">Aún no hay fotografías publicadas</h2><p className="mx-auto mt-3 max-w-xl leading-7 text-muted">Solo se muestran imágenes con consentimiento vigente.</p></div> : <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{assets.map((asset) => <li className="overflow-hidden rounded-2xl border border-black/10 bg-surface shadow-sm" id={`asset-${asset.assetId}`} key={asset.assetId}><div className="aspect-[4/3] bg-brand-900 p-5 text-white"><p className="text-sm font-bold uppercase tracking-wide text-accent">Gym ADR</p><p className="mt-3 text-xl font-black">Fotografía optimizada publicada</p><p className="mt-2 text-sm opacity-80">Derivado protegido: {asset.publicObjectKey.split("/").at(-1)}</p></div><div className="p-4"><time className="text-sm text-muted" dateTime={asset.publishedAt}>{new Date(asset.publishedAt).toLocaleDateString("es-PY")}</time><button className="mt-3 block min-h-11 rounded-lg border border-brand-900 px-4 font-bold" onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}/galeria#asset-${asset.assetId}`)} type="button">Copiar enlace público</button></div></li>)}</ul>}</section>;
}
