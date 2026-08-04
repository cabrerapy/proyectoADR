import Link from "next/link";

export function SiteHeader() {
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

        <nav aria-label="Navegación principal">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-md px-3 font-semibold hover:bg-white/10"
          >
            Inicio
          </Link>
        </nav>
      </div>
    </header>
  );
}
