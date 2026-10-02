import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppShell } from "@/components/shell/AppShell";
import { getBuildInfo } from "@/lib/queries/build";
import "./globals.css";
import "./story.css";

/**
 * The three faces of the design: a grotesque for structure, a serif for
 * reading, and a mono that carries every scientific quantity. The mono is
 * doing the most work here — a number in this system is a measurement, and it
 * is set like one.
 *
 * Self-hosted rather than fetched through `next/font/google`. All three are
 * variable fonts, and asking the Google loader for a list of discrete weights
 * made it emit one source entry per weight — which the bundler on the
 * deployment host could not resolve, failing the build on a font rather than on
 * anything to do with the site. Shipping the variable files removes the
 * network from the build entirely and gives a continuous weight axis instead
 * of five fixed stops. All three are licensed under the SIL Open Font License.
 *
 * The files are trimmed to what the site uses: weights 400 to 700, and
 * Bricolage fixed at its normal width (its condensed range was never used).
 * That took the four files from 378 KB to 254 KB with no visible change.
 */
const display = localFont({
  src: "./fonts/BricolageGrotesque.woff2",
  weight: "400 700",
  variable: "--font-display-loaded",
  display: "swap",
});

const body = localFont({
  src: [
    { path: "./fonts/Literata.woff2", style: "normal", weight: "400 700" },
    { path: "./fonts/LiterataItalic.woff2", style: "italic", weight: "400 700" },
  ],
  variable: "--font-body-loaded",
  display: "swap",
});

const mono = localFont({
  src: "./fonts/GeistMono.woff2",
  weight: "400 700",
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AMR Drug Repurposing",
  description:
    "Search approved medicines for AI-predicted antibacterial activity against MRSA, " +
    "E. coli, K. pneumoniae and M. tuberculosis, and see the documented evidence " +
    "behind each one. Nothing here establishes clinical benefit.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const build = await getBuildInfo();

  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
      style={{
        // Bind the loaded font variables into the design tokens, keeping the
        // system stack as the fallback the tokens already declare.
        ["--font-display" as string]: `var(--font-display-loaded), ui-sans-serif, system-ui, sans-serif`,
        ["--font-body" as string]: `var(--font-body-loaded), Georgia, serif`,
        ["--font-mono" as string]: `var(--font-mono-loaded), ui-monospace, monospace`,
      }}
    >
      <body>
        {build.dataVersion ? (
          // React hoists this into <head>. The integrity tests compare it with
          // the database to prove the page was not served from a stale cache.
          <meta name="amr-data-version" content={build.dataVersion} />
        ) : null}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
