import type { Metadata } from "next";

import { ExternalLink, InfoCard, PageHero, PrimaryLink } from "@/components/public-page";
import { getPublicSiteContent } from "@/content/public-site-content";

export const metadata: Metadata = { title: "Contacto y ubicación | Gym ADR" };

export default function ContactPage() {
  const content = getPublicSiteContent();
  const socialLinks = [
    content.instagramUrl ? { href: content.instagramUrl, label: "Instagram" } : undefined,
    content.facebookUrl ? { href: content.facebookUrl, label: "Facebook" } : undefined,
  ].filter((item): item is { href: string; label: string } => item !== undefined);

  return (
    <main id="main-content" tabIndex={-1} className="flex-1">
      <PageHero eyebrow="Contacto" title="Hablemos de tu entrenamiento">
        <p>Encontranos en Limpio o consultá cómo iniciar tu solicitud de ingreso.</p>
      </PageHero>
      <section className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-16 sm:px-6 md:grid-cols-2 lg:px-8">
        <InfoCard title="Ubicación">
          <address className="not-italic">{content.address}</address>
          <p className="mt-4"><ExternalLink href={content.mapUrl}>Abrir ubicación en Google Maps</ExternalLink></p>
        </InfoCard>
        <InfoCard title="Canales de contacto">
          {content.whatsappUrl ? <ExternalLink href={content.whatsappUrl}>Escribir por WhatsApp</ExternalLink> : <p aria-live="polite">WhatsApp pendiente de configuración.</p>}
          {socialLinks.length > 0 ? <ul className="mt-4 flex flex-wrap gap-4">{socialLinks.map((link) => <li key={link.label}><ExternalLink href={link.href}>{link.label}</ExternalLink></li>)}</ul> : <p className="mt-4 text-sm">Las redes sociales se publicarán cuando estén configuradas.</p>}
        </InfoCard>
        <div className="md:col-span-2 mt-3"><PrimaryLink href="/ingreso">Solicitar ingreso</PrimaryLink></div>
      </section>
    </main>
  );
}
