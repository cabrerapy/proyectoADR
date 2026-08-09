import Link from "next/link";

import { getPublicSiteContent } from "@/content/public-site-content";

export function SiteHeader() {
  const content = getPublicSiteContent();

  return (
    <header className="border-b border-white/10 bg-brand-900 text-white">
      <div className="mx-auto flex min-h-20 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="Gym ADR, inicio"
          className="inline-flex items-center gap-3 rounded-sm font-black tracking-tight"
        >
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-full bg-accent text-sm text-brand-900"
          >
            ADR
          </span>
          <span>Gym ADR</span>
        </Link>

        <nav aria-label="Navegación principal" className="hidden items-center gap-1 lg:flex">
          {content.navigation.map((item) => (
            <Link key={item.href} href={item.href} className="inline-flex min-h-11 items-center rounded-md px-3 font-semibold hover:bg-white/10">
              {item.label}
            </Link>
          ))}
          <Link href="/ingreso" className="ml-2 inline-flex min-h-11 items-center rounded-md bg-accent px-4 font-bold text-brand-900 hover:bg-white">
            Solicitar ingreso
          </Link>
        </nav>

        <nav aria-label="Navegación principal" className="lg:hidden">
          <details className="mobile-navigation relative">
            <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md px-3 font-bold hover:bg-white/10">Menú</summary>
            <div className="absolute right-0 z-20 mt-2 flex w-64 flex-col rounded-xl bg-surface p-3 text-ink shadow-xl">
              {content.navigation.map((item) => (
                <Link key={item.href} href={item.href} className="flex min-h-11 items-center rounded-md px-3 font-semibold hover:bg-canvas">{item.label}</Link>
              ))}
              <Link href="/ingreso" className="mt-2 flex min-h-11 items-center rounded-md bg-accent px-3 font-bold text-brand-900">Solicitar ingreso</Link>
            </div>
          </details>
        </nav>
      </div>
    </header>
  );
}
