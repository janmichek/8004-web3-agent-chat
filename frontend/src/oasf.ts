/**
 * OASF (Open Agentic Schema Framework) taxonomy — fetched live, never hardcoded.
 *
 * Source: https://schema.oasf.outshift.com/api/1.1.0/skill_categories
 * Docs:   https://schema.oasf.outshift.com/doc
 *
 * Domains = top-level classes (e.g. id "6" → Software Engineering).
 * Skills  = second-level capabilities (e.g. id "602" → Web Development).
 * Leaf modules ([10101]…) are intentionally omitted — selection stops at skill level.
 */
export type OasfSkill = { id: string; name: string; slug: string };
export type OasfDomain = { id: string; name: string; slug: string; skills: OasfSkill[] };

export const OASF_SCHEMA_URL = 'https://schema.oasf.outshift.com/';
export const OASF_VERSION = '1.1.0';
export const OASF_TAXONOMY_URL = `${OASF_SCHEMA_URL}api/${OASF_VERSION}/skill_categories`;

type OasfApiSkillNode = {
  id: number | string;
  caption?: string;
  name?: string;
  classes?: Record<string, OasfApiSkillNode>;
};

type OasfApiTaxonomy = Record<string, OasfApiSkillNode>;

/**
 * Fetch the live OASF skill taxonomy and transform it to the
 * `{ id, name, slug, skills[] }` shape the UI needs.
 *
 * - `id`   = numeric-string ID used on-chain (e.g. "6", "602")
 * - `name` = human caption for display (e.g. "Software Engineering")
 * - `slug` = canonical snake_case name from OASF (e.g. "software_engineering"),
 *            used for the `domains` array 8004scan renders.
 */
export async function fetchOasfDomains(): Promise<OasfDomain[]> {
  const res = await fetch(OASF_TAXONOMY_URL);
  if (!res.ok) {
    throw new Error(`OASF taxonomy fetch failed (${res.status})`);
  }
  const data = (await res.json()) as OasfApiTaxonomy;
  const domains: OasfDomain[] = Object.values(data).map((d) => {
    const skills: OasfSkill[] = Object.values(d.classes ?? {}).map((s) => ({
      id: String(s.id),
      name: s.caption ?? s.name ?? String(s.id),
      slug: String(s.name ?? s.id),
    }));
    skills.sort((a, b) => Number(a.id) - Number(b.id));
    return {
      id: String(d.id),
      name: d.caption ?? d.name ?? String(d.id),
      slug: String(d.name ?? d.id),
      skills,
    };
  });
  domains.sort((a, b) => Number(a.id) - Number(b.id));
  return domains;
}
