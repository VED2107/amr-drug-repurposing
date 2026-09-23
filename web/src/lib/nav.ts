/**
 * Navigation structure — the one source every navigating surface reads.
 *
 * Inside the application the sections are a research index, not a menu: they
 * are numbered in the order evidence is built — screen the library, explore a
 * medicine, weigh the evidence, inspect the system that produced it — with the
 * roadmap set apart as future work. The same index is the left rail on a wide
 * screen and the sheet behind the location bar on a phone.
 *
 * An entry may carry a `readout`: the key of one live figure the index prints
 * beside it, so the navigation also reports the state of the thing it leads
 * to. The figures themselves are read from the database per request; this file
 * only says which one belongs where.
 */

export type ReadoutKey =
  | "medicines"
  | "predictions"
  | "models"
  | "structures"
  | "docked"
  | "clinical"
  | "future";

export interface NavItem {
  href: string;
  label: string;
  readout?: ReadoutKey;
}

export interface NavGroup {
  /** Two-digit stage number, or null for the unnumbered Future group. */
  n: string | null;
  label: string;
  items: NavItem[];
}

/** The two places outside the index: the narrative Overview and the Dashboard. */
export const TOP_NAV: NavItem[] = [
  { href: "/", label: "Overview" },
  { href: "/dashboard", label: "Dashboard" },
];

export const APP_NAV: NavGroup[] = [
  {
    n: "00",
    label: "Overview",
    items: [{ href: "/dashboard", label: "Research overview" }],
  },
  {
    n: "01",
    label: "Screen",
    items: [
      { href: "/screening", label: "Drug Screening", readout: "predictions" },
      { href: "/candidates", label: "Candidate Explorer", readout: "models" },
    ],
  },
  {
    n: "02",
    label: "Explore",
    items: [
      { href: "/medicines", label: "Drug Details", readout: "medicines" },
      { href: "/case-study", label: "Case Study" },
      { href: "/explorer", label: "Medicine × Condition" },
    ],
  },
  {
    n: "03",
    label: "Evidence",
    items: [
      { href: "/molecular", label: "Molecular", readout: "structures" },
      { href: "/docking", label: "Docking & 3D", readout: "docked" },
      { href: "/clinical", label: "Clinical", readout: "clinical" },
    ],
  },
  {
    n: "04",
    label: "System",
    items: [
      { href: "/pipeline", label: "Pipeline" },
      { href: "/models", label: "Models & Dataset", readout: "models" },
      { href: "/retraining", label: "Retraining" },
    ],
  },
  {
    n: null,
    label: "Future",
    items: [{ href: "/roadmap", label: "Roadmap", readout: "future" }],
  },
];

export function isCurrent(item: NavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The group and entry of the current page, for the location bar and markers. */
export function locate(pathname: string): { group: NavGroup; item: NavItem } | null {
  for (const group of APP_NAV) {
    const item = group.items.find((i) => isCurrent(i, pathname));
    if (item) return { group, item };
  }
  return null;
}

/** Routes that render inside the application frame (index visible). */
export function isAppRoute(pathname: string): boolean {
  return pathname !== "/";
}
