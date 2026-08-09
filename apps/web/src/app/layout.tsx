import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getPublicSiteContent } from "@/content/public-site-content";

import "./globals.css";

const publicContent = getPublicSiteContent();

export const metadata: Metadata = {
  metadataBase: new URL(publicContent.siteUrl),
  title: {
    default: "Gym ADR",
    template: "%s | Gym ADR",
  },
  applicationName: "Gym ADR",
  description:
    "Cross training en Limpio, Paraguay: gimnasio, planes, horarios y solicitud de ingreso.",
  alternates: { canonical: "/" },
  openGraph: {
    description:
      "Entrenamiento de cross training adaptado a tu nivel en Limpio, Paraguay.",
    locale: "es_PY",
    siteName: "Gym ADR",
    title: "Gym ADR",
    type: "website",
    url: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="flex min-h-screen flex-col antialiased">
        <a className="skip-link" href="#main-content">
          Ir al contenido principal
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
