import type { Metadata } from "next";

import { PageHero, PrimaryLink } from "@/components/public-page";
import { getPublicSiteContent } from "@/content/public-site-content";

export const metadata: Metadata = {
  alternates: { canonical: "/horarios" },
  description: "Consultá los horarios generales de entrenamiento de Gym ADR.",
  title: "Horarios",
};

export const revalidate = 3600;

export default function SchedulesPage() {
  const content = getPublicSiteContent();

  return (
    <main id="main-content" tabIndex={-1} className="flex-1">
      <PageHero eyebrow="Horarios generales" title="Encontrá tu momento para entrenar">
        <p>Estos son los turnos generales. Las sesiones concretas y sus cupos estarán disponibles para alumnos activos.</p>
      </PageHero>
      <section className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="overflow-x-auto rounded-2xl border border-black/10 bg-surface">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Horarios generales de Gym ADR</caption>
            <thead className="bg-brand-900 text-white"><tr><th className="p-4" scope="col">Actividad</th><th className="p-4" scope="col">Días</th><th className="p-4" scope="col">Horario</th></tr></thead>
            <tbody>{content.schedules.map((schedule) => <tr key={`${schedule.name}-${schedule.days}`} className="border-t border-black/10"><th className="p-4 font-bold" scope="row">{schedule.name}</th><td className="p-4 text-muted">{schedule.days}</td><td className="p-4 text-muted">{schedule.hours}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mt-5 text-sm leading-6 text-muted" role="note">Los horarios pueden cambiar. Consultá antes de acercarte al gimnasio.</p>
        <div className="mt-8"><PrimaryLink href="/contacto">Consultar horarios</PrimaryLink></div>
      </section>
    </main>
  );
}
