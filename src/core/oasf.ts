/**
 * OASF (Open Agentic Schema Framework) taxonomy snapshot for the backend.
 *
 * Mirrors `frontend/src/oasf.ts`. 8004scan renders the OASF card from the
 * `services` array entry named `oasf`, where:
 * - `skills` are numeric-string skill IDs (e.g. "1001"), and
 * - `domains` are snake_case slugs (e.g. "agent_management") — NOT numeric IDs.
 *
 * @module oasf
 */

/** OASF schema version pinned by this codebase. */
export const OASF_VERSION = "1.1.0";

/** Numeric domain ID → snake_case slug shown on 8004scan. */
export const OASF_DOMAIN_SLUGS: Record<string, string> = {
  "1": "language_processing",
  "2": "computer_vision",
  "3": "audio_speech_processing",
  "4": "3d_generation",
  "5": "multimodal_processing",
  "6": "software_engineering",
  "7": "ai_ml_engineering",
  "8": "data_engineering_and_analytics",
  "9": "devops_and_cloud_infrastructure",
  "10": "cybersecurity",
  "11": "content_writing_and_marketing",
  "12": "business_and_professional",
  "13": "research_knowledge_and_productivity",
  "14": "science_and_specialized_domains",
  "15": "reasoning_and_planning",
  "16": "mathematical_reasoning",
  "17": "tool_use_and_automation",
  "18": "governance_compliance_and_ethics",
};

/**
 * Translate numeric domain IDs to the snake_case slugs 8004scan expects.
 * Unknown IDs pass through unchanged so future taxonomy additions don't break.
 */
export function oasfDomainSlugs(ids: string[]): string[] {
  return ids.map((id) => OASF_DOMAIN_SLUGS[id] ?? id);
}

/**
 * Build the `oasf` service entry for the ERC-8004 registration file's
 * `services` array, matching the shape 8004scan renders
 * (`endpoint` / `version` / `skills` / `domains`).
 *
 * @param domains Numeric domain IDs (translated to slugs internally).
 * @param skills Numeric skill IDs (passed through as-is).
 * @param endpoint Public https base for the OASF descriptor. 8004scan does
 *   not health-check `oasf` services, so this is display metadata.
 */
export function buildOasfService(
  domains: string[],
  skills: string[],
  endpoint: string,
): { name: string; endpoint: string; version: string; skills: string[]; domains: string[] } {
  return {
    name: "oasf",
    endpoint,
    version: OASF_VERSION,
    skills: [...skills],
    domains: oasfDomainSlugs(domains),
  };
}
