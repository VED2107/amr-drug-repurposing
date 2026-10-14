import "server-only";

import { unstable_cache } from "next/cache";
import { cache } from "react";

/**
 * The single database entry point for the website.
 *
 * Production runs against Supabase Postgres. Local development and the data
 * integrity tests can run against the research SQLite database directly, which
 * is what makes it possible to assert "what the page shows equals what the
 * scientific database holds" without standing up a server.
 *
 * Both drivers execute the *same* SQL. Every query in `src/lib/queries` is
 * written in the portable subset both engines accept — `case when` instead of
 * `filter (where ...)`, window functions instead of `distinct on`. That
 * constraint is deliberate: two dialects would mean two chances for a number
 * to drift, and a number drifting is the one failure this project cannot have.
 *
 * Placeholders are written `?` and rewritten to `$1, $2, …` for Postgres.
 */

export type DataSource = "supabase" | "sqlite";

export function dataSource(): DataSource {
  const configured = process.env.AMR_DATA_SOURCE;
  if (configured === "sqlite" || configured === "supabase") return configured;
  // Default to Supabase: a deployment that is missing configuration should
  // fail loudly rather than quietly serving a developer's local file.
  return "supabase";
}

export interface QueryResult<T> {
  rows: T[];
}

/** Rewrites `?` placeholders to Postgres `$n`, ignoring those inside strings. */
export function toPostgresPlaceholders(sql: string): string {
  let out = "";
  let index = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;

    if (ch === "?" && !inSingle && !inDouble) {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
  }
  return out;
}

type Params = ReadonlyArray<string | number | boolean | null>;

interface Driver {
  all<T>(sql: string, params: Params): Promise<T[]>;
}

let driverPromise: Promise<Driver> | null = null;

async function createSqliteDriver(): Promise<Driver> {
  // Dynamic import keeps better-sqlite3 (a native module, and a devDependency)
  // out of the production bundle entirely.
  const { default: Database } = await import("better-sqlite3");
  const path = process.env.AMR_SQLITE_PATH;
  if (!path) {
    throw new Error(
      "AMR_DATA_SOURCE=sqlite requires AMR_SQLITE_PATH to point at data/amr.sqlite",
    );
  }
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma("query_only = true");

  return {
    async all<T>(sql: string, params: Params): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
  };
}

async function createSupabaseDriver(): Promise<Driver> {
  // Either name works. Supabase hands out DATABASE_URL; SUPABASE_DB_URL is the
  // name the ETL script uses, so accepting both avoids a second copy of a
  // credential just to satisfy a spelling.
  const url = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL (or SUPABASE_DB_URL) is not set. See web/.env.example for the " +
        "variables this application needs.",
    );
  }
  const { default: postgres } = await import("postgres");
  const open = () => postgres(url, {
    // Required for Supabase's transaction pooler, which is what a serverless
    // deployment on Vercel should connect through.
    prepare: false,
    /*
      On Vercel, every serverless function invocation can start its own Node
      process, each of which opens its own pool. With tens of concurrent
      instances, the connections multiply: 10 per instance × 20 instances =
      200, which is the pooler's hard limit. Two connections per instance
      keeps the aggregate well under 200 even during traffic spikes, while
      still allowing two concurrent reads on a single page.
    */
    max: 2,
    /*
      One statement in flight per connection. By default postgres.js pipelines:
      it writes the next queued statement before the previous reply arrives. If
      one reply is lost, every statement queued behind it on that connection
      waits with it. Measured through the transaction pooler, a batch of eight
      pipelined reads left seven pending indefinitely; without pipelining the
      same batch completed. A queued read now waits for a free connection
      instead, which beside the database costs milliseconds.
    */
    // Honoured by postgres.js at runtime (src/index.js) but absent from its
    // 3.4 type definitions, hence the spread.
    ...({ max_pipeline: 0 } as object),
    /*
      How long an idle connection is kept. Sixty seconds is long enough to
      share a connection across the reads of a page and across a reader who
      clicks through two or three medicines, but short enough that a quiet
      instance releases its connections before the pooler accumulates too many.
      (At 300 s and max: 10, idle instances held connections for five minutes
      and the pooler reached its 200-connection limit during normal use.)
    */
    idle_timeout: 60,
    // The production tables live in the `amr` schema, but the queries are
    // written unqualified so that the same statement runs against the research
    // SQLite file. Setting the search path here is what keeps that true.
    connection: { search_path: "amr,public" },
  });

  let pool = open();

  /*
    A read that missed its deadline is sitting on a connection that may never
    hear back, and a retry must not queue behind it. The pool is replaced, and
    the old one is closed once its other reads have had a moment to finish;
    any it cuts off fail as CONNECTION_ENDED and are asked again on the new one.

    The stuck statement is deliberately not cancelled. Through a transaction
    pooler a cancel request is routed to whichever backend the pooler picks,
    which by then may be running someone else's statement — the update
    worker's, for instance.
  */
  function replace(stuck: typeof pool) {
    if (pool !== stuck) return;
    pool = open();
    void stuck.end({ timeout: 5 }).catch(() => {});
  }

  return {
    async all<T>(text: string, params: Params): Promise<T[]> {
      const statement = toPostgresPlaceholders(text);
      for (let attempt = 1; ; attempt++) {
        const current = pool;
        try {
          const rows = await withinDeadline(
            current.unsafe(statement, params as never[]),
            QUERY_DEADLINE_MS,
          );
          return rows as unknown as T[];
        } catch (error) {
          if (codeOf(error) === "QUERY_DEADLINE") replace(current);
          if (attempt >= QUERY_ATTEMPTS || !isTransient(error)) throw error;
        }
      }
    },
  };
}

/*
  Every read has a deadline, and a read that fails at the connection is asked
  once more.

  Without a deadline, a reply lost between the pooler and this process left the
  query pending forever, and the page with it: the request hung until the HTTP
  client gave up at 300 seconds, which is where the five-minute integrity test
  came from. Now a page either renders from an answer or fails within about a
  minute and a half, and shows the error page — which substitutes nothing.

  Where it was measured, the replies that went missing were the large ones: a
  path that drops packets above its MTU (a VPN tunnel, in that case) delivers
  a one-row count and loses a 90 KB result. The deadline is what turns that
  from a silent hang into a reported failure wherever it happens.

  Only failures of the connection itself are retried. Every statement here is a
  read, so asking twice cannot change anything; a query that is wrong fails the
  same way twice and is reported, not retried further.
*/
const QUERY_DEADLINE_MS = 40_000;
const QUERY_ATTEMPTS = 2;

const TRANSIENT_CODES = new Set([
  // postgres.js, for a socket that failed to open or closed under a query
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "ECONNRESET",
  "ETIMEDOUT",
  // Postgres connection exceptions — the pooler reports a handshake it gave up
  // on as 08006 (EAUTHTIMEOUT)
  "08000",
  "08001",
  "08003",
  "08006",
  // A cancel that the transaction pooler delivered to a shared backend; the
  // role this site reads as carries no statement timeout of its own
  "57014",
  "QUERY_DEADLINE",
]);

function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

function isTransient(error: unknown): boolean {
  const code = codeOf(error);
  return code !== null && TRANSIENT_CODES.has(code);
}

function withinDeadline<T>(pending: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(new Error(`The database did not answer within ${ms / 1000} s.`), {
          code: "QUERY_DEADLINE",
        }),
      );
    }, ms);
  });
  // An abandoned read must never surface later as an unhandled rejection.
  Promise.resolve(pending).catch(() => {});
  return Promise.race([Promise.resolve(pending), deadline]).finally(() => clearTimeout(timer));
}

function driver(): Promise<Driver> {
  if (!driverPromise) {
    driverPromise =
      dataSource() === "sqlite" ? createSqliteDriver() : createSupabaseDriver();
  }
  return driverPromise;
}

/**
 * The version of the published data, read fresh once per request.
 *
 * Migration 0003 makes every transaction that writes to the `amr` schema record
 * itself in `data_changes`, atomically with the write. This returns the size
 * and high-water mark of that log, so it changes exactly when the data does.
 *
 * It is never cached. `cache` here only shares the one answer among the queries
 * of a single request, which is what makes every figure on a page come from the
 * same version of the data. If it cannot be read, nothing on the page is served
 * from the cache: the request fails, and the error page says so.
 */
export const dataVersion = cache(async (): Promise<string> => {
  if (dataSource() === "sqlite") return "sqlite";
  const d = await driver();
  const [row] = await d.all<{ n: unknown; last: unknown }>(
    `select count(*) as n, max(xact_id) as last from data_changes`,
    [],
  );
  return `${String(row.n)}.${String(row.last ?? 0)}`;
});

/**
 * A backstop, not the freshness rule.
 *
 * Freshness comes from the data version in the cache key: once a pipeline run,
 * the update worker or the ETL commits, the next request carries a new version
 * and misses every cached read. The timer only bounds how long an entry lives
 * if a write ever bypassed the triggers (a restore run with triggers disabled).
 */
const READ_CACHE_SECONDS = 300;

/*
  The cached read.

  Keyed on the statement, its parameters and the data version, so two pages
  issuing the same query against the same data share one result, a filtered
  table does not collide with an unfiltered one, and nothing read before a
  publish is served after it. The rows returned are the rows the database
  returned; the version decides only whether they may be reused.

  Before the version was part of the key, each query's entry aged on its own
  clock, survived restarts and redeploys, and — this is how `unstable_cache`
  behaves — an expired entry was served once more while it refreshed, and served
  again if the refresh failed. A page could then show a count the database no
  longer held, next to a count read a moment later.
*/
const cachedRead = unstable_cache(
  async (text: string, serialisedParams: string, version: string) => {
    void version; // part of the cache key only
    const d = await driver();
    return d.all<unknown>(text, JSON.parse(serialisedParams) as Params);
  },
  ["amr-read-v2"],
  { revalidate: READ_CACHE_SECONDS },
);

/**
 * Open the connection pool ahead of traffic.
 *
 * Warms both connections in the (now small) pool so the first page does not
 * pay two pooler handshakes. Called from `instrumentation.ts`; failures are
 * ignored — requests still open connections as they always did.
 */
export async function warmPool(connections = 2): Promise<void> {
  if (dataSource() === "sqlite") return;
  const d = await driver();
  await Promise.all(Array.from({ length: connections }, () => d.all("select 1", []).catch(() => [])));
}

/** Run a query and return every row, typed by the caller. */
export async function query<T>(sql: string, params: Params = []): Promise<T[]> {
  // The local SQLite driver is already on the same machine, and caching it
  // would only make the integrity tests read stale rows mid-run.
  if (dataSource() === "sqlite") {
    const d = await driver();
    return d.all<T>(sql, params);
  }
  const version = await dataVersion();
  return (await cachedRead(sql, JSON.stringify(params), version)) as T[];
}

/**
 * Run a query against the live database, bypassing the read cache.
 *
 * For the docking queue only. Its tables live in the `docking` schema, which
 * deliberately carries no data-version trigger (a queue writes several times a
 * second), so a cached read would never be invalidated. Progress must be read
 * as it is now. Returns `null` when the site runs against the research SQLite
 * file, which has no docking queue.
 */
export async function queryLive<T>(sql: string, params: Params = []): Promise<T[] | null> {
  if (dataSource() === "sqlite") return null;
  const d = await driver();
  return d.all<T>(sql, params);
}

/** Run a query expected to return at most one row. */
export async function queryOne<T>(sql: string, params: Params = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Coerce a SQLite integer-boolean or a Postgres boolean to a real boolean,
 * preserving `null`. `null` means unknown and must not become `false`.
 */
export function toBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "t" || value === "true" || value === "1";
  return null;
}

/** Coerce to a finite number, preserving `null`. Never defaults to zero. */
export function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parse a JSON column that may arrive as text (SQLite) or an object (Postgres). */
export function toJson<T>(value: unknown): T | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Split a delimited column into a list, dropping only genuinely empty entries.
 * The research database joins multi-valued text columns with "; ".
 */
export function toList(value: unknown, separator = "; "): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  return value
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
