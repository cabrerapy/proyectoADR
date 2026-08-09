import type { Metadata } from "next";
import Link from "next/link";

import { InfoCard, PageHero } from "@/components/public-page";

export const metadata: Metadata = {
  alternates: { canonical: "/ingreso" },
  description: "Iniciá tu solicitud de ingreso a Gym ADR con Google o Facebook.",
  robots: { follow: true, index: true },
  title: "Solicitud de ingreso",
};

export const revalidate = 3600;

const providerClassName = "inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-brand-900 px-5 py-3 text-center font-bold text-brand-900 hover:bg-brand-900 hover:text-white";

export default function JoinPage() {
  return (
    <main id="main-content" tabIndex={-1} className="flex-1">
      <PageHero eyebrow="Solicitud de ingreso" title="Empezá tu camino en Gym ADR">
        <p>Autenticate con una cuenta externa, completá tus datos y esperá la revisión del equipo administrativo.</p>
      </PageHero>
      <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_0.7fr] lg:px-8">
        <div>
          <h2 className="text-3xl font-black">¿Cómo funciona?</h2>
          <ol className="mt-6 grid gap-4">
            <li><InfoCard title="1. Iniciá sesión"><p>Usá Google o Facebook para verificar tu identidad.</p></InfoCard></li>
            <li><InfoCard title="2. Completá tu perfil"><p>Cargá solamente la información necesaria para evaluar la solicitud.</p></InfoCard></li>
            <li><InfoCard title="3. Esperá la aprobación"><p>Tu estado será PENDING hasta que un administrador revise la solicitud.</p></InfoCard></li>
          </ol>
        </div>
        <aside className="h-fit rounded-2xl bg-surface p-6 shadow-sm" aria-labelledby="join-access-title">
          <h2 id="join-access-title" className="text-2xl font-black">Elegí cómo continuar</h2>
          <p className="mt-3 leading-7 text-muted">Autenticarte no activa automáticamente tu cuenta de alumno.</p>
          <div className="mt-6 grid gap-3">
            <Link href="/api/auth/login?provider=Google" className={providerClassName}>Continuar con Google</Link>
            <Link href="/api/auth/login?provider=Facebook" className={providerClassName}>Continuar con Facebook</Link>
          </div>
        </aside>
      </section>
    </main>
  );
}
