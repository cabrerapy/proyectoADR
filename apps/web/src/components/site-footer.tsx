import Link from "next/link";

import { getPublicSiteContent } from "@/content/public-site-content";

export function SiteFooter() {
  const content = getPublicSiteContent();

  return (
    <footer className="bg-brand-900 text-white">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:px-8">
        <div>
          <p className="text-lg font-black">Gym ADR</p>
          <p className="mt-2 max-w-sm text-sm leading-6 text-white/75">Cross training para entrenar con propósito en {content.city}.</p>
        </div>
        <nav aria-label="Enlaces del pie de página" className="flex flex-wrap items-start gap-x-5 gap-y-2 text-sm font-semibold sm:justify-end">
          <Link href="/contacto" className="underline underline-offset-4">Contacto</Link>
          <Link href="/galeria" className="underline underline-offset-4">Galería</Link>
          <Link href="/ingreso" className="underline underline-offset-4">Solicitud de ingreso</Link>
        </nav>
      </div>
    </footer>
  );
}
