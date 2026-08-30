/**
 * Cloudflare D1 over its HTTP query API.
 *
 * The app runs on Vercel, so there is no Workers binding available — every
 * statement goes out as an authenticated POST to Cloudflare's REST endpoint.
 * That makes each query a network round trip, so batch where you can and keep
 * per-request statement counts low.
 */

const CF_API = "https://api.cloudflare.com/client/v4";

export type D1Row = Record<string, unknown>;

interface D1QueryResult<T> {
  results: T[];
  success: boolean;
  meta: {
    changes?: number;
    last_row_id?: number;
    rows_read?: number;
    rows_written?: number;
    duration?: number;
  };
}

interface D1Envelope<T> {
  result: D1QueryResult<T>[];
  success: boolean;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
}

function config() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    throw new Error(
      "D1 is not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN."
    );
  }
  return { accountId, databaseId, apiToken };
}

/** Run one parameterised statement and return its rows. */
export async function d1Query<T = D1Row>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const { accountId, databaseId, apiToken } = config();

  const res = await fetch(
    `${CF_API}/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
      cache: "no-store",
    }
  );

  const body = (await res.json()) as D1Envelope<T>;

  if (!res.ok || !body.success) {
    const detail =
      body?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ||
      `HTTP ${res.status}`;
    throw new Error(`D1 query failed — ${detail}`);
  }

  return body.result?.[0]?.results ?? [];
}

/** Run a statement for its side effect; returns rows changed. */
export async function d1Execute(
  sql: string,
  params: unknown[] = []
): Promise<number> {
  const { accountId, databaseId, apiToken } = config();

  const res = await fetch(
    `${CF_API}/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
      cache: "no-store",
    }
  );

  const body = (await res.json()) as D1Envelope<D1Row>;

  if (!res.ok || !body.success) {
    const detail =
      body?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ||
      `HTTP ${res.status}`;
    throw new Error(`D1 execute failed — ${detail}`);
  }

  return body.result?.[0]?.meta?.changes ?? 0;
}

/**
 * Send several statements in one request. D1's endpoint accepts a SQL string
 * containing multiple statements; use this for setup and multi-step writes so
 * one round trip covers them all.
 */
export async function d1Batch(statements: string[]): Promise<void> {
  if (!statements.length) return;
  const { accountId, databaseId, apiToken } = config();

  const res = await fetch(
    `${CF_API}/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: statements.join(";\n") }),
      cache: "no-store",
    }
  );

  const body = (await res.json()) as D1Envelope<D1Row>;

  if (!res.ok || !body.success) {
    const detail =
      body?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ||
      `HTTP ${res.status}`;
    throw new Error(`D1 batch failed — ${detail}`);
  }
}

export function isD1Configured(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
      process.env.CLOUDFLARE_D1_DATABASE_ID &&
      process.env.CLOUDFLARE_API_TOKEN
  );
}
