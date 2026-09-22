import "server-only";

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
  const sql = postgres(url, {
    // Required for Supabase's transaction pooler, which is what a serverless
    // deployment on Vercel should connect through.
    prepare: false,
    max: 1,
    idle_timeout: 20,
    // The production tables live in the `amr` schema, but the queries are
    // written unqualified so that the same statement runs against the research
    // SQLite file. Setting the search path here is what keeps that true.
    connection: { search_path: "amr,public" },
  });

  return {
    async all<T>(text: string, params: Params): Promise<T[]> {
      const rows = await sql.unsafe(toPostgresPlaceholders(text), params as never[]);
      return rows as unknown as T[];
    },
  };
}

function driver(): Promise<Driver> {
  if (!driverPromise) {
    driverPromise =
      dataSource() === "sqlite" ? createSqliteDriver() : createSupabaseDriver();
  }
  return driverPromise;
}

/** Run a query and return every row, typed by the caller. */
export async function query<T>(sql: string, params: Params = []): Promise<T[]> {
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
