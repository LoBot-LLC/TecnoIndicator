"use client";

import { useEffect } from "react";
import { inject } from "@vercel/analytics";

/**
 * Client-side component that injects the Vercel Analytics script.
 * Uses the `inject` function from `@vercel/analytics` instead of the
 * `<Analytics />` component from `@vercel/analytics/next` to avoid
 * Turbopack bundling issues with duplicate "Analytics" name.
 */
export default function VercelAnalytics() {
  useEffect(() => {
    inject({
      mode: "production",
    });
  }, []);

  return null;
}