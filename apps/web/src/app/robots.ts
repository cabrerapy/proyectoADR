import type { MetadataRoute } from "next";

import { getPublicSiteContent } from "@/content/public-site-content";

export default function robots(): MetadataRoute.Robots {
  const { siteUrl } = getPublicSiteContent();

  return {
    host: siteUrl,
    rules: {
      allow: "/",
      disallow: ["/api/", "/admin/", "/me/", "/onboarding"],
      userAgent: "*",
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
