import type { Metadata } from "next";

import { PageHero, PrimaryLink } from "@/components/public-page";

export const metadata: Metadata = { title: "Galería | Gym ADR" };

export default function GalleryPage() {
  return (
    <main id="main-content" tabIndex={-1} className="flex-1">
      <PageHero eyebrow="Galería" title="Así se vive Gym ADR">
        <p>Las fotografías publicadas por el gimnasio aparecerán aquí con su versión optimizada y marca de agua.</p>
      </PageHero>
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8" aria-labelledby="gallery-empty-title">
        <div className="rounded-2xl border border-dashed border-brand-700/40 bg-surface px-6 py-14 text-center">
          <h2 id="gallery-empty-title" className="text-2xl font-black">Aún no hay fotografías publicadas</h2>
          <p className="mx-auto mt-3 max-w-xl leading-7 text-muted">La galería mostrará únicamente imágenes autorizadas y publicadas por la administración.</p>
          <div className="mt-7"><PrimaryLink href="/gimnasio" secondary>Conocer el gimnasio</PrimaryLink></div>
        </div>
      </section>
    </main>
  );
}
