import type { MetadataRoute } from "next";

import { getPublicSiteContent } from "@/content/public-site-content";

const routes = [
  { changeFrequency: "weekly", path: "", priority: 1 },
  { changeFrequency: "monthly", path: "/gimnasio", priority: 0.8 },
  { changeFrequency: "weekly", path: "/planes", priority: 0.8 },
  { changeFrequency: "weekly", path: "/horarios", priority: 0.8 },
  { changeFrequency: "weekly", path: "/galeria", priority: 0.7 },
  { changeFrequency: "monthly", path: "/contacto", priority: 0.7 },
  { changeFrequency: "monthly", path: "/ingreso", priority: 0.7 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const { siteUrl } = getPublicSiteContent();

  return routes.map((route) => ({
    changeFrequency: route.changeFrequency,
    priority: route.priority,
    url: `${siteUrl}${route.path}`,
  }));
}
