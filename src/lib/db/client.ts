import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

type DbInstance = ReturnType<typeof drizzle<typeof schema>>;

// Cache the pool + drizzle instance on globalThis so `next dev`'s
// hot-module-reload doesn't spin up a fresh Postgres connection pool on
// every edit.
const globalForDb = globalThis as unknown as { pgPool?: Pool; drizzleDb?: DbInstance };

function getDb(): DbInstance {
  if (!globalForDb.drizzleDb) {
    const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
    globalForDb.pgPool = pool;
    globalForDb.drizzleDb = drizzle({ client: pool, schema });
  }
  return globalForDb.drizzleDb;
}

// Proxied so `getEnv()`/pool creation only happens on first actual query,
// not on module import — Next.js imports route handler modules during
// `next build`'s page-data-collection pass (with no real env vars present)
// just to read their config exports, without calling any handler code.
export const db: DbInstance = new Proxy({} as DbInstance, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
