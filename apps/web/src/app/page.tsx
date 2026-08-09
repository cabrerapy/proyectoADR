import { InfoCard, PrimaryLink, SectionHeading } from "@/components/public-page";

export default function Home() {
  return (
    <main id="main-content" tabIndex={-1} className="flex-1">
      <section className="hero-grid text-white">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_0.65fr] lg:px-8">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-accent">Cross training en Limpio</p>
            <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-6xl">Entrená con propósito.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/85 sm:text-xl">Acompañamiento, comunidad y entrenamiento adaptable para que avances desde tu nivel actual.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <PrimaryLink href="/ingreso">Solicitar ingreso</PrimaryLink>
              <PrimaryLink href="/planes" secondary inverted>Ver planes</PrimaryLink>
            </div>
          </div>
          <aside className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-sm" aria-label="Información para comenzar">
            <p className="text-sm font-bold uppercase tracking-wider text-accent">Tu primer paso</p>
            <h2 className="mt-3 text-2xl font-black">No necesitás experiencia previa</h2>
            <p className="mt-3 leading-7 text-white/80">Conocé el espacio, consultá los horarios y enviá tu solicitud. El equipo revisará tu ingreso antes de activar tu cuenta.</p>
          </aside>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8" aria-labelledby="home-services">
        <SectionHeading eyebrow="Conocé Gym ADR" title="Todo lo necesario para empezar">
          <p>Información clara antes de visitarnos o solicitar tu ingreso.</p>
        </SectionHeading>
        <div id="home-services" className="mt-8 grid gap-5 md:grid-cols-3">
          <InfoCard title="Entrenamiento adaptado"><p>Progresiones pensadas para distintos niveles y objetivos.</p></InfoCard>
          <InfoCard title="Espacio equipado"><p>Áreas de fuerza, acondicionamiento y movilidad para clases completas.</p></InfoCard>
          <InfoCard title="Comunidad cercana"><p>Un gimnasio local donde entrenar con acompañamiento y constancia.</p></InfoCard>
        </div>
        <div className="mt-10"><PrimaryLink href="/gimnasio" secondary>Conocer el gimnasio</PrimaryLink></div>
      </section>
    </main>
  );
}
