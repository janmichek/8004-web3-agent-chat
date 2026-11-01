import { ref, watch } from "vue";
import { fetchMemory, type AgentSummary, type MemorySummary } from "@/shared/api";

/**
 * Loads `memory.json` for the selected agent.
 * Reloads when the agent changes or `refreshKey` is bumped.
 */
export function useAgentMemory(
  agent: () => AgentSummary | null | undefined,
  refreshKey: () => number | undefined = () => undefined,
) {
  const memory = ref<MemorySummary | null>(null);
  const loading = ref(false);
  const error = ref("");

  async function load() {
    const name = agent()?.name;
    if (!name) {
      memory.value = null;
      error.value = "";
      return;
    }
    loading.value = true;
    error.value = "";
    try {
      memory.value = await fetchMemory(name);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      memory.value = null;
    } finally {
      loading.value = false;
    }
  }

  watch(() => agent()?.name, load, { immediate: true });
  watch(refreshKey, () => {
    void load();
  });

  return { memory, loading, error, load };
}
