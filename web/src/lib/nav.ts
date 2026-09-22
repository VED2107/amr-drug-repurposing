/**
 * Navigation structure.
 *
 * The two-tier shape comes from the design: a primary tier that separates the
 * narrative Overview from the working Dashboard, and a grouped secondary tier
 * that only appears once you are inside the application.
 *
 * The design's System group carried Pipeline alone. The research system also
 * has model, dataset, retraining and run-history surfaces, so the group is
 * extended here rather than inventing a new place to put them.
 *
 * Roadmap sits in the primary tier next to Overview rather than inside the
 * application. It carries no live data — it is the presentation's future-work
 * list — and a narrative surface inside the working nav reads as though the
 * system already does what it describes.
 */

export interface NavItem {
  href: string;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const TOP_NAV: NavItem[] = [
  { href: "/", label: "Overview" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/dashboard", label: "Dashboard" },
];

export const APP_NAV: NavGroup[] = [
  { label: "Overview", items: [{ href: "/dashboard", label: "Research overview" }] },
  {
    label: "Screen",
    items: [
      { href: "/screening", label: "Drug Screening" },
      { href: "/candidates", label: "Candidate Explorer" },
    ],
  },
  {
    label: "Explore",
    items: [
      { href: "/medicines", label: "Drug Details" },
      { href: "/case-study", label: "Case Study" },
      { href: "/explorer", label: "Medicine × Disease" },
    ],
  },
  {
    label: "Evidence",
    items: [
      { href: "/molecular", label: "Molecular" },
      { href: "/docking", label: "Docking & 3D" },
      { href: "/clinical", label: "Clinical" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/pipeline", label: "Pipeline" },
      { href: "/models", label: "Models & Dataset" },
      { href: "/retraining", label: "Retraining" },
      { href: "/runs", label: "Run History" },
    ],
  },
];

/** Routes that render inside the application shell (secondary nav visible). */
export function isAppRoute(pathname: string): boolean {
  return pathname !== "/";
}
