<script setup lang="ts">
import { computed } from 'vue'
import { findNetwork } from '../networks'

const props = withDefaults(
  defineProps<{
    chainId: number
    size?: number
  }>(),
  { size: 20 },
)

/** Family key so Sepolia / mainnet variants share one mark. */
const family = computed(() => {
  const id = props.chainId
  if (id === 42161 || id === 421614) return 'arbitrum'
  if (id === 11155111 || id === 1) return 'ethereum'
  if (id === 5000 || id === 5003) return 'mantle'
  return 'unknown'
})

const label = computed(() => findNetwork(props.chainId)?.shortName ?? `Chain ${props.chainId}`)

const sizePx = computed(() => `${props.size}px`)
</script>

<template>
  <span
    class="net-icon"
    :data-family="family"
    :style="{ width: sizePx, height: sizePx }"
    :title="label"
    aria-hidden="true"
  >
    <!-- Arbitrum -->
    <svg v-if="family === 'arbitrum'" viewBox="0 0 32 32" focusable="false">
      <circle cx="16" cy="16" r="16" fill="#213147" />
      <path
        fill="#28A0F0"
        d="M21.6 8.2 10.1 23.4h3.4l2.3-3.1h6.5l1.4 3.1h3.5L16.9 8.2h4.7zm-3.4 4.1 2.1 4.6h-4.2l2.1-4.6z"
      />
      <path fill="#fff" d="M8.4 23.4 16.2 8.2h-3.1L6.2 20.1v3.3h2.2z" />
    </svg>

    <!-- Ethereum -->
    <svg v-else-if="family === 'ethereum'" viewBox="0 0 32 32" focusable="false">
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      <path fill="#fff" fill-opacity=".6" d="M16.5 4v8.9l7.5 3.3L16.5 4z" />
      <path fill="#fff" d="M16.5 4 9 16.2l7.5-3.3V4z" />
      <path fill="#fff" fill-opacity=".6" d="M16.5 21.97v6.02L24 17.62l-7.5 4.35z" />
      <path fill="#fff" d="M16.5 27.99v-6.02L9 17.62l7.5 10.37z" />
      <path fill="#fff" fill-opacity=".2" d="M16.5 20.57l7.5-4.37-7.5-3.34v7.71z" />
      <path fill="#fff" fill-opacity=".6" d="M9 16.2l7.5 4.37v-7.71L9 16.2z" />
    </svg>

    <!-- Mantle -->
    <svg v-else-if="family === 'mantle'" viewBox="0 0 32 32" focusable="false">
      <circle cx="16" cy="16" r="16" fill="#000" />
      <path
        fill="#fff"
        d="M8.2 22.5V9.5h3.1l4.7 8.6 4.7-8.6h3.1v13H21V14.2l-3.9 7.1h-2.2L11 14.2v8.3H8.2z"
      />
    </svg>

    <!-- Fallback -->
    <svg v-else viewBox="0 0 32 32" focusable="false">
      <circle cx="16" cy="16" r="16" fill="currentColor" opacity="0.18" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        font-size="14"
        font-weight="700"
        fill="currentColor"
      >
        ?
      </text>
    </svg>
  </span>
</template>

<style scoped>
.net-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 999px;
  overflow: hidden;
  color: var(--ink);
}

.net-icon svg {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
