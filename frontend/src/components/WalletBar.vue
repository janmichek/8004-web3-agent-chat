<script setup lang="ts">
import { computed, onMounted, ref, unref, watch } from 'vue'
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from '@wagmi/vue'
import { arbitrum, arbitrumSepolia } from '@wagmi/vue/chains'
import { formatEther } from 'viem'
import { ensureArbitrumSepolia, getInjectedChainId } from '../chain'

const { address, isConnected, status, chainId: accountChainId } = useAccount()
const { connectors, connect, isPending } = useConnect()
const { disconnect } = useDisconnect()
const { switchChain } = useSwitchChain()

const walletChainId = ref<number | undefined>(undefined)
const switching = ref(false)

async function refreshWalletChain() {
  if (!isConnected.value) {
    walletChainId.value = undefined
    return
  }
  try {
    walletChainId.value = await getInjectedChainId()
  } catch {
    walletChainId.value = accountChainId.value
  }
}

watch([isConnected, accountChainId], () => {
  void refreshWalletChain()
})

onMounted(() => {
  void refreshWalletChain()
})

const shortAddress = computed(() => {
  if (!address.value) return ''
  return `${address.value.slice(0, 6)}…${address.value.slice(-4)}`
})

const activeChainId = computed(() => walletChainId.value ?? accountChainId.value)

const chainLabel = computed(() => {
  const id = activeChainId.value
  if (id === arbitrumSepolia.id) return 'Arb Sepolia'
  if (id === arbitrum.id) return 'Arbitrum'
  if (id == null) return 'Unknown'
  return `Chain ${id}`
})

const wrongNetwork = computed(
  () => isConnected.value && activeChainId.value !== arbitrumSepolia.id,
)

const eth = useBalance({ address: address })
const ethDisplay = computed(() => {
  if (!isConnected.value || !address.value) return null
  if (unref(eth.isFetching) && unref(eth.data) === undefined) return '…'
  const d = unref(eth.data)
  if (d?.value === undefined) return null
  return `${Number(formatEther(d.value)).toPrecision(5)} ETH`
})

function connectWallet() {
  const connector = connectors[0]
  if (connector) connect({ connector })
}

async function onSwitchClick() {
  switching.value = true
  try {
    await ensureArbitrumSepolia()
    await refreshWalletChain()
  } catch {
    switchChain({ chainId: arbitrumSepolia.id })
  } finally {
    switching.value = false
  }
}
</script>

<template>
  <header class="bar">
    <div class="brand">
      <img class="mark" src="/favicon.svg" alt="web3Agent logo" width="32" height="32" />
      <div>
        <p class="name">web3Agent</p>
        <p class="tag">Arbitrum · ERC-8004</p>
      </div>
    </div>

    <div class="actions">
      <template v-if="isConnected">
        <button
          type="button"
          class="chip"
          :class="{ warn: wrongNetwork }"
          :disabled="switching"
          @click="onSwitchClick"
        >
          {{ switching ? 'Switching…' : wrongNetwork ? `Switch · ${chainLabel}` : chainLabel }}
        </button>
        <span class="addr mono">{{ shortAddress }}</span>
        <span v-if="ethDisplay" class="balance mono">{{ ethDisplay }}</span>
        <button type="button" class="btn ghost" @click="disconnect()">Disconnect</button>
      </template>
      <button
        v-else
        type="button"
        class="btn primary"
        :disabled="isPending || status === 'connecting'"
        @click="connectWallet"
      >
        {{ isPending || status === 'connecting' ? 'Connecting…' : 'Connect wallet' }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border);
  background: color-mix(in oklab, var(--surface) 88%, transparent);
  backdrop-filter: blur(10px);
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.mark {
  width: 2rem;
  height: 2rem;
  border-radius: 0.4rem;
  object-fit: contain;
  display: block;
  flex-shrink: 0;
}

.name {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.05rem;
  letter-spacing: -0.02em;
}

.tag {
  margin: 0;
  color: var(--muted);
  font-size: 0.75rem;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.addr {
  font-size: 0.85rem;
  color: var(--ink);
  padding: 0.35rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  background: var(--surface-2);
}

.balance {
  font-size: 0.82rem;
  color: var(--ink);
  padding: 0.35rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  background: var(--surface-2);
}

.chip {
  font: inherit;
  font-size: 0.75rem;
  padding: 0.35rem 0.6rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--ink);
  cursor: pointer;
}

.chip:disabled {
  opacity: 0.6;
  cursor: wait;
}

.chip.warn {
  border-color: color-mix(in oklab, var(--warn) 50%, var(--border));
  color: var(--warn);
}

@media (max-width: 640px) {
  .bar {
    padding: 0.85rem 1rem;
  }
  .tag {
    display: none;
  }
}
</style>
