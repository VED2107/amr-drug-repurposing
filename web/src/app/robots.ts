import type { MetadataRoute } from "next";

/**
 * Every page on this site is rendered on request, so each crawler hit is a
 * function invocation and a round of database reads. Crawlers may index the
 * pages themselves, but not the API, the CSV exports, or the filter and sort
 * variants (every query string is another uncached render of the same page).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/docking", "/*?"],
      },
    ],
  };
}
