/**
 * Sitemap for TecnoIndicator.
 *
 * This file generates the /sitemap.xml route that lists all the static pages of the site.
 * Since this is a single-page application, the sitemap includes the main page and the various anchor sections.
 */

import type { MetadataRoute } from "next";

const baseUrl = "https://tecnoindicator.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  // For a single-page application, we include the main URL and the key anchor sections
  // to enable Google to discover the different sections of the page.
  const routes = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
    // Include key anchor sections from the homepage
    {
      url: `${baseUrl}#forecast`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}#regions`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}#factors`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}#about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];

  return routes as MetadataRoute.Sitemap;
}