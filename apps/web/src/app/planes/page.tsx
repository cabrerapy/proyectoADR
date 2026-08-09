import type { Metadata } from "next";

import { InfoCard, PageHero, PrimaryLink } from "@/components/public-page";
import { getPublicSiteContent } from "@/content/public-site-content";

export const metadata: Metadata = {
  alternates: { canonical: "/planes" },
  description: "Consultá los planes y precios de entrenamiento de Gym ADR.",
  title: "Planes y precios",
};

export const revalidate = 3600;

export default function PlansPage() {
  const content = getPublicSiteContent();

  return (
    <main id="main-content" tabIndex={-1} className="flex-1">
      <PageHero eyebrow="Planes y precios" title="Una opción para cada ritmo">
        <p>Elegí una frecuencia acorde a tus objetivos. Confirmaremos disponibilidad y precio antes de activar tu membresía.</p>
      </PageHero>
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8" aria-label="Planes disponibles">
        <div className="grid gap-5 md:grid-cols-3">
          {content.plans.map((plan) => (
            <InfoCard key={plan.name} title={plan.name}>
              <p>{plan.description}</p>
              <p className="mt-4 font-bold text-ink">{plan.frequency}</p>
              <p className="mt-1 text-2xl font-black text-brand-700">{plan.priceLabel}</p>
            </InfoCard>
          ))}
        </div>
        <div className="mt-8 rounded-xl border border-accent/60 bg-accent/15 p-5 text-sm leading-6 text-muted" role="note">Los precios y frecuencias definitivos serán configurados por la administración. No se realizará ningún cobro en línea durante el MVP.</div>
        <div className="mt-8 flex flex-wrap gap-3"><PrimaryLink href="/contacto">Consultar un plan</PrimaryLink><PrimaryLink href="/ingreso" secondary>Solicitar ingreso</PrimaryLink></div>
      </section>
    </main>
  );
}
