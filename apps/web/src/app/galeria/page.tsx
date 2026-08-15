import type { Metadata } from "next";

import { PageHero } from "@/components/public-page";
import { PublicGalleryClient } from "./public-gallery-client";

export const metadata: Metadata = {
  alternates: { canonical: "/galeria" },
  description: "Conocé el ambiente y las actividades de Gym ADR.",
  title: "Galería",
};

export const revalidate = 3600;

export default function GalleryPage() {
  return <main id="main-content" tabIndex={-1} className="flex-1"><PageHero eyebrow="Galería" title="Así se vive Gym ADR"><p>Fotografías optimizadas, autorizadas y protegidas con la marca de agua del gimnasio.</p></PageHero><PublicGalleryClient /></main>;
}
