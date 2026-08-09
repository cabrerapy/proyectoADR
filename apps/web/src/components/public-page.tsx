import Link from "next/link";
import type { ReactNode } from "react";

export function PageHero({ eyebrow, title, children }: Readonly<{ children: ReactNode; eyebrow: string; title: string }>) {
  return (
    <header className="bg-brand-900 text-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-accent">{eyebrow}</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">{title}</h1>
        <div className="mt-5 max-w-2xl text-lg leading-8 text-white/85">{children}</div>
      </div>
    </header>
  );
}

export function SectionHeading({ eyebrow, title, children }: Readonly<{ children?: ReactNode; eyebrow: string; title: string }>) {
  return (
    <div className="max-w-3xl">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand-700">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-4xl">{title}</h2>
      {children ? <div className="mt-4 leading-7 text-muted">{children}</div> : null}
    </div>
  );
}

export function InfoCard({ title, children }: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <article className="rounded-2xl border border-black/10 bg-surface p-6 shadow-sm">
      <h3 className="text-xl font-black text-ink">{title}</h3>
      <div className="mt-3 leading-7 text-muted">{children}</div>
    </article>
  );
}

export function PrimaryLink({ children, href, secondary = false, inverted = false }: Readonly<{ children: ReactNode; href: string; inverted?: boolean; secondary?: boolean }>) {
  const secondaryStyle = inverted
    ? "border border-white/50 text-white hover:bg-white hover:text-brand-900"
    : "border border-brand-900 text-brand-900 hover:bg-brand-900 hover:text-white";

  return (
    <Link href={href} className={`inline-flex min-h-12 items-center justify-center rounded-lg px-5 py-3 font-bold transition ${secondary ? secondaryStyle : "bg-accent text-brand-900 hover:bg-white"}`}>
      {children}
    </Link>
  );
}

export function ExternalLink({ children, href }: Readonly<{ children: ReactNode; href: string }>) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-bold text-brand-700 underline decoration-2 underline-offset-4 hover:text-brand-900">
      {children}
      <span className="sr-only"> (abre en una pestaña nueva)</span>
    </a>
  );
}
