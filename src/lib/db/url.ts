/**
 * postgres.js forwards unrecognised query parameters to the server as startup
 * options, and Neon's connection strings carry `channel_binding`, which
 * Postgres rejects. Callers request TLS explicitly instead.
 *
 * Kept free of environment access so scripts can import it without
 * constructing a database connection.
 */
export function normalizePgUrl(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.delete("channel_binding");
  parsed.searchParams.delete("sslmode");
  return parsed.toString();
}
