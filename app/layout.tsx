import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { CurrencyProvider } from "../src/context/CurrencyContext";
import { ThemeProvider } from "../src/context/ThemeContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "TecnoIndicator — Oil, Electricity & Water Price Forecasts",
  description:
    "TecnoIndicator — real-time 10-year forecasts for global oil, electricity & water prices. Interactive scenarios, key drivers and exportable analytics.",
  applicationName: "TecnoIndicator",
  openGraph: {
    title: "TecnoIndicator — Oil, Electricity & Water Price Forecasts",
    description:
      "Real-time 10-year forecasts for global oil, electricity & water prices. Interactive scenarios, key drivers and exportable analytics.",
    type: "website",
  },
};

/** Organization structured data for rich search results (knowledge panel, logos). */
const ORGANIZATION_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "TecnoIndicator",
  url: "https://tecnoindicator.vercel.app",
  logo: "https://tecnoindicator.vercel.app/favicon.ico",
  sameAs: [
    "https://github.com/ilovecheesez/tecnoindicator",
  ],
};

/** Website structured data for rich search results. */
const WEBSITE_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Website",
  name: "TecnoIndicator",
  url: "https://tecnoindicator.vercel.app",
  description:
    "TecnoIndicator — real-time 10-year forecasts for global oil, electricity & water prices. Interactive scenarios, key drivers and exportable analytics.",
  inLanguage: "en-US",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#060a13",
};

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23060a13'/%3E%3Cpath d='M6 20 L11 13 L16 18 L21 9 L26 12' stroke='%232dd4bf' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_SCHEMA).replace(/</g, "\\u003c") }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_SCHEMA).replace(/</g, "\\u003c") }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
        />
        <link rel="icon" href={FAVICON} />
      </head>
      <body>
        <ThemeProvider>
          <CurrencyProvider>{children}</CurrencyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
