// Split out from queries.ts (which imports the Postgres client) so client
// components can import this value without pulling `pg` into the browser
// bundle — a value import from queries.ts drags the whole module in, unlike
// a `import type` which the compiler erases.
export const ROLLING_WEEKS = 4;
