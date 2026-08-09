import type { Metadata } from "next";

import { InfoCard, PageHero, PrimaryLink, SectionHeading } from "@/components/public-page";
import { getPublicSiteContent } from "@/content/public-site-content";

export const metadata: Metadata = {
  alternates: { canonical: "/gimnasio" },
  description: "Conocé los entrenadores, instalaciones y equipamiento de Gym ADR.",
  title: "El gimnasio",
};

export const revalidate = 3600;

export default function GymPage() {
  const content = getPublicSiteContent();

  return (
    <main id="main-content" tabIndex={-1} className="flex-1">
      <PageHero eyebrow="Gym ADR" title="Un espacio para moverte mejor">
        <p>Entrenamiento de cross training en Limpio, con progresiones adaptadas y acompañamiento del equipo.</p>
      </PageHero>
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Entrenadores" title="Acompañamiento en cada etapa">
          <p>El equipo orienta la técnica y adapta cada sesión al nivel de quien entrena.</p>
        </SectionHeading>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {content.trainers.map((trainer) => <InfoCard key={trainer.name} title={trainer.name}><p>{trainer.specialty}</p></InfoCard>)}
        </div>
      </section>
      <section className="bg-surface">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <SectionHeading eyebrow="Instalaciones" title="Áreas pensadas para entrenar" />
            <ul className="mt-6 space-y-3 text-muted">{content.facilities.map((item) => <li key={item} className="rounded-xl bg-canvas p-4">{item}</li>)}</ul>
          </div>
          <div>
            <SectionHeading eyebrow="Equipamiento" title="Herramientas para progresar" />
            <ul className="mt-6 space-y-3 text-muted">{content.equipment.map((item) => <li key={item} className="rounded-xl bg-canvas p-4">{item}</li>)}</ul>
          </div>
        </div>
      </section>
      <section className="mx-auto flex w-full max-w-6xl flex-col items-start gap-5 px-4 py-14 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-black">¿Querés conocernos?</h2>
        <div className="flex flex-wrap gap-3"><PrimaryLink href="/ingreso">Solicitar ingreso</PrimaryLink><PrimaryLink href="/contacto" secondary>Contactar</PrimaryLink></div>
      </section>
    </main>
  );
}
