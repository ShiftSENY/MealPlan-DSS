// ==========================================================================
// Neon serverless client (Option A — browser-only)
// --------------------------------------------------------------------------
// The driver is loaded lazily from a CDN so a network hiccup while loading
// it does not take the whole app down. All queries are parameterised.
// ==========================================================================

import { NEON_CONNECTION_STRING } from "./neon-config.js";

let sql = null;        // cached tagged-template query function
let loading = null;    // in-flight import promise

// Is a real connection string present (not the placeholder)?
export function isDbConfigured() {
  return (
    typeof NEON_CONNECTION_STRING === "string" &&
    NEON_CONNECTION_STRING.startsWith("postgres") &&
    !NEON_CONNECTION_STRING.includes("REPLACE_ME")
  );
}

// Lazily import the driver and create the query function.
export async function getSql() {
  if (sql) return sql;
  if (!isDbConfigured()) {
    throw new Error(
      "Database not configured. Paste your Neon connection string into neon-config.js."
    );
  }
  if (!loading) {
    loading = import("https://esm.sh/@neondatabase/serverless@0.9.4").then((mod) => {
      sql = mod.neon(NEON_CONNECTION_STRING);
      return sql;
    });
  }
  return loading;
}
