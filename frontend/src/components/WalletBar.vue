<script setup lang="ts">
import { computed, onMounted, ref, unref, watch } from 'vue'
import { useAccount, useBalance, useConfig, useSwitchChain } from '@wagmi/vue'
import { useWeb3Auth, useWeb3AuthConnect, useWeb3AuthDisconnect } from '@web3auth/modal/vue'
import { formatEther } from 'viem'
import { ensureChain, getInjectedChainId } from '../chain'
import { SUPPORTED_NETWORKS, findNetwork, isSupportedChain } from '../networks'

const wagmiConfig = useConfig()
const { address, chainId: accountChainId } = useAccount()
const { isInitialized, initError } = useWeb3Auth()
const {
  connect,
  isConnected,
  loading: connectLoading,
  error: connectError,
} = useWeb3AuthConnect()
const { disconnect, loading: disconnectLoading } = useWeb3AuthDisconnect()
const { switchChain } = useSwitchChain()

const signInDisabled = computed(
  () => connectLoading.value || !isInitialized.value || !!initError.value,
)
const authError = computed(() => initError.value ?? connectError.value)

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
  if (id == null) return 'Unknown'
  return findNetwork(id)?.shortName ?? `Chain ${id}`
})

const wrongNetwork = computed(() => isConnected.value && !isSupportedChain(activeChainId.value))

const eth = useBalance({ address: address })
const ethDisplay = computed(() => {
  if (!isConnected.value || !address.value) return null
  if (unref(eth.isFetching) && unref(eth.data) === undefined) return '…'
  const d = unref(eth.data)
  if (d?.value === undefined) return null
  return `${Number(formatEther(d.value)).toPrecision(5)} ETH`
})

async function onSignIn() {
  await connect()
}

async function onSignOut() {
  await disconnect()
}

async function onChainPicked(event: Event) {
  const select = event.target as HTMLSelectElement
  const chainId = Number(select.value)
  if (!isSupportedChain(chainId) || chainId === activeChainId.value) return
  switching.value = true
  try {
    await ensureChain(wagmiConfig, chainId)
  } catch {
    switchChain({ chainId })
  } finally {
    await refreshWalletChain()
    // The wallet may have refused: show the chain it is really on.
    select.value = String(activeChainId.value ?? '')
    switching.value = false
  }
}
</script>

<template>
  <header class="bar">
    <div class="brand">
      <img class="mark" src="/favicon.svg" alt="Web3 Agent Chat logo" width="32" height="32" />
      <div>
        <p class="name">Web3 Agent Chat</p>
        <p class="tag">Multichain · ERC-8004</p>
      </div>
    </div>

    <div class="actions">
      <template v-if="isConnected">
        <select
          class="chip"
          :class="{ warn: wrongNetwork }"
          :disabled="switching"
          :value="activeChainId"
          aria-label="Wallet network"
          :title="switching ? 'Switching…' : 'Switch wallet network'"
          data-testid="wallet-network"
          @change="onChainPicked"
        >
          <option v-if="wrongNetwork || activeChainId == null" :value="activeChainId ?? ''" disabled>
            Switch · {{ chainLabel }}
          </option>
          <option v-for="n in SUPPORTED_NETWORKS" :key="n.chainId" :value="n.chainId">
            {{ n.shortName }}
          </option>
        </select>
        <span class="addr mono">{{ shortAddress }}</span>
        <span v-if="ethDisplay" class="balance mono">{{ ethDisplay }}</span>
        <button
          type="button"
          class="btn ghost"
          :disabled="disconnectLoading"
          @click="onSignOut"
        >
          {{ disconnectLoading ? 'Signing out…' : 'Sign out' }}
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="btn primary"
          :disabled="signInDisabled"
          @click="onSignIn"
        >
          {{
            connectLoading
              ? 'Signing in…'
              : initError
                ? 'Sign in unavailable'
                : !isInitialized
                  ? 'Preparing…'
                  : 'Sign in'
          }}
        </button>
        <p v-if="authError" class="auth-error">{{ authError.message }}</p>
      </template>
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

.auth-error {
  margin: 0;
  font-size: 0.75rem;
  color: var(--danger, #c0392b);
  max-width: 16rem;
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
