import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppShell } from "@/components/shell/AppShell";
import { getBuildInfo } from "@/lib/queries/build";
import { getNavReadouts } from "@/lib/queries/nav";
import "./globals.css";

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
 * network from the build entirely and gives the full weight axis instead of
 * five fixed stops. All three are licensed under the SIL Open Font License.
 */
const display = localFont({
  src: "./fonts/BricolageGrotesque.woff2",
  weight: "200 800",
  variable: "--font-display-loaded",
  display: "swap",
});

const body = localFont({
  src: [
    { path: "./fonts/Literata.woff2", style: "normal", weight: "200 900" },
    { path: "./fonts/LiterataItalic.woff2", style: "italic", weight: "200 900" },
  ],
  variable: "--font-body-loaded",
  display: "swap",
});

const mono = localFont({
  src: "./fonts/GeistMono.woff2",
  weight: "100 900",
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AMR Research — Smart Screening",
  description:
    "A screening framework that scores already-approved medicines for predicted " +
    "antibacterial activity against four drug-resistant bacteria, and shows the " +
    "evidence behind each result. No medicine is ranked and nothing here " +
    "establishes clinical benefit.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const build = await getBuildInfo();
  const readouts = await getNavReadouts();

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
        <AppShell build={build} readouts={readouts}>{children}</AppShell>
      </body>
    </html>
  );
}
