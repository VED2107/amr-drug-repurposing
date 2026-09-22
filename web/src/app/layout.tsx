import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Literata } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { getBuildInfo } from "@/lib/queries/build";
import "./globals.css";

/**
 * The three faces of the design: a grotesque for structure, a serif for
 * reading, and a mono that carries every scientific quantity. The mono is
 * doing the most work here — a number in this system is a measurement, and it
 * is set like one.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-display-loaded",
  display: "swap",
});

const body = Literata({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-body-loaded",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AMR Research — Smart Screening",
  description:
    "A screening framework that ranks already-approved medicines for predicted " +
    "antibacterial activity against four drug-resistant bacteria, and shows the " +
    "evidence behind each result.",
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
        <AppShell build={build}>{children}</AppShell>
      </body>
    </html>
  );
}
