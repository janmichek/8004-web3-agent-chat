/**
 * OASF (Open Agentic Schema Framework) taxonomy — fetched live, never hardcoded.
 *
 * Source: https://schema.oasf.outshift.com/api/1.1.0/skill_categories
 * Docs:   https://schema.oasf.outshift.com/doc
 *
 * 8004scan renders the OASF card from the `services` array entry named
 * `oasf`, where:
 * - `skills` are numeric-string skill IDs (e.g. "1001"), and
 * - `domains` are snake_case slugs (e.g. "software_engineering") — NOT numeric IDs.
 *
 * Domain IDs (e.g. "6") are translated to slugs via the live taxonomy.
 * Unknown IDs pass through unchanged so future taxonomy additions don't break.
 *
 * @module oasf
 */

/** OASF schema version pinned by this codebase. */
export const OASF_VERSION = "1.1.0";

/** Base URL of the OASF schema server. */
export const OASF_SCHEMA_URL = "https://schema.oasf.outshift.com/";

/** Live taxonomy endpoint (skill categories = domains + skills tree). */
export const OASF_TAXONOMY_URL = `${OASF_SCHEMA_URL}api/${OASF_VERSION}/skill_categories`;

type OasfApiNode = {
  id: number | string;
  name?: string;
  caption?: string;
  classes?: Record<string, OasfApiNode>;
};

let cachedSlugs: Record<string, string> | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Fetch the live domain ID → slug map from the OASF schema server.
 * Results are cached in-memory for an hour.
 */
export async function fetchOasfDomainSlugs(): Promise<Record<string, string>> {
  if (cachedSlugs && Date.now() < cacheExpiresAt) return cachedSlugs;
  const res = await fetch(OASF_TAXONOMY_URL);
  if (!res.ok) {
    throw new Error(`OASF taxonomy fetch failed (${res.status})`);
  }
  const data = (await res.json()) as Record<string, OasfApiNode>;
  const slugs: Record<string, string> = {};
  for (const node of Object.values(data)) {
    slugs[String(node.id)] = String(node.name ?? node.id);
  }
  cachedSlugs = slugs;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return slugs;
}

/**
 * Translate numeric domain IDs to the snake_case slugs 8004scan expects,
 * using the live OASF taxonomy. Falls back to passing IDs through unchanged
 * if the schema server is unreachable.
 */
export async function oasfDomainSlugs(ids: string[]): Promise<string[]> {
  try {
    const slugs = await fetchOasfDomainSlugs();
    return ids.map((id) => slugs[id] ?? id);
  } catch {
    return [...ids];
  }
}

/**
 * Build the `oasf` service entry for the ERC-8004 registration file's
 * `services` array, matching the shape 8004scan renders
 * (`endpoint` / `version` / `skills` / `domains`).
 *
 * @param domains Numeric domain IDs (translated to slugs internally via live taxonomy).
 * @param skills Numeric skill IDs (passed through as-is).
 * @param endpoint Public https base for the OASF descriptor. 8004scan does
 *   not health-check `oasf` services, so this is display metadata.
 */
export async function buildOasfService(
  domains: string[],
  skills: string[],
  endpoint: string,
): Promise<{ name: string; endpoint: string; version: string; skills: string[]; domains: string[] }> {
  return {
    name: "oasf",
    endpoint,
    version: OASF_VERSION,
    skills: [...skills],
    domains: await oasfDomainSlugs(domains),
  };
}
