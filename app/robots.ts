/**
 * Robots.txt for TecnoIndicator.
 *
 * This file tells search engine crawlers which URLs they can access on the site.
 * The App Router's robots.ts file is automatically served at /robots.txt.
 */

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Disallow API routes and admin areas (if any)
      disallow: [
        "/api/",
        "/_next/",
        "/private/",
      ],
    },
    // Point crawlers to the sitemap for better indexing
    sitemap: "https://tecnoindicator.vercel.app/sitemap.xml",
  };
}