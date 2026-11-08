<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue'
import { useAccount, useBalance, useConfig, useSwitchChain } from '@wagmi/vue'
import { useWeb3Auth, useWeb3AuthConnect, useWeb3AuthDisconnect } from '@web3auth/modal/vue'
import { formatEther } from 'viem'
import { ensureChain, getInjectedChainId } from '@/shared/lib'
import { setThemePreference, themePreference, type ThemePreference } from '@/shared/lib'
import { SUPPORTED_NETWORKS, findNetwork, isSupportedChain } from '@/shared/config'
import { UserIcon } from '@/shared/ui'

const wagmiConfig = useConfig()
const { address, chainId: accountChainId, status: accountStatus } = useAccount()
const { isInitialized, initError } = useWeb3Auth()
const { connect, isConnected, loading: connectLoading } = useWeb3AuthConnect()
const { disconnect, loading: disconnectLoading } = useWeb3AuthDisconnect()
const { switchChain } = useSwitchChain()

const signInDisabled = computed(
  () => connectLoading.value || !isInitialized.value || !!initError.value,
)

const showAccount = computed(() => isConnected.value && !!address.value)

const authPending = computed(
  () =>
    !initError.value &&
    !showAccount.value &&
    (!isInitialized.value ||
      isConnected.value ||
      !!address.value ||
      accountStatus.value === 'reconnecting' ||
      accountStatus.value === 'connecting'),
)

const walletChainId = ref<number | undefined>(undefined)
const switching = ref(false)
const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
const faucetCopied = ref(false)
let faucetTimer: ReturnType<typeof setTimeout> | undefined

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

watch(isConnected, (connected) => {
  if (!connected) menuOpen.value = false
})

onMounted(() => {
  void refreshWalletChain()
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onDocKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onDocKeydown)
  if (faucetTimer) clearTimeout(faucetTimer)
})

function onDocPointerDown(event: PointerEvent) {
  if (!menuOpen.value || !menuRoot.value) return
  const target = event.target as Node | null
  if (target && !menuRoot.value.contains(target)) {
    menuOpen.value = false
  }
}

function onDocKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && menuOpen.value) {
    menuOpen.value = false
  }
}

async function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    await nextTick()
  }
}

const shortAddress = computed(() => {
  if (!address.value) return ''
  return `${address.value.slice(0, 6)}…${address.value.slice(-4)}`
})

const activeChainId = computed(() => walletChainId.value ?? accountChainId.value)

const activeNetwork = computed(() => findNetwork(activeChainId.value))

const chainLabel = computed(() => {
  const id = activeChainId.value
  if (id == null) return 'Unknown'
  return activeNetwork.value?.shortName ?? `Chain ${id}`
})

const faucetUrl = computed(() => activeNetwork.value?.faucetUrl)

const faucetLabel = computed(() => {
  const symbol = activeNetwork.value?.nativeCurrency?.symbol ?? 'ETH'
  return `Get test ${symbol}`
})

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
  { value: 'auto', label: 'Auto', icon: '◐' },
  { value: 'light', label: 'Light', icon: '☀' },
  { value: 'dark', label: 'Dark', icon: '☾' },
]

const themePreferenceLabel = computed(
  () => THEME_OPTIONS.find((o) => o.value === themePreference.value)?.label ?? 'Auto',
)

const themeLabel = computed(
  () => `Appearance: ${themePreferenceLabel.value}. Choose Auto, Light or Dark.`,
)

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
  menuOpen.value = false
  await disconnect()
}

async function copyFaucetAddress(addr: string) {
  try {
    await navigator.clipboard.writeText(addr)
    faucetCopied.value = true
  } catch {
    // Clipboard API unavailable (non-secure context) — still open the faucet.
  }
}

function onFaucetClick(event: MouseEvent) {
  const url = faucetUrl.value
  const addr = address.value
  if (!url || !addr) return
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
  if (modified) {
    void copyFaucetAddress(addr)
    return
  }
  event.preventDefault()
  if (faucetTimer) clearTimeout(faucetTimer)
  faucetCopied.value = false
  void copyFaucetAddress(addr)
  faucetTimer = setTimeout(() => {
    faucetTimer = undefined
    menuOpen.value = false
    window.open(url, '_blank', 'noopener,noreferrer')
  }, 1000)
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
  <header class="bar" :class="{ 'menu-open': menuOpen }">
    <div class="brand">
      <div class="brand-mark">
        <slot name="menu" />
        <span class="mark" role="img" aria-label="W3AC logo"></span>
      </div>
      <span class="wordmark" aria-hidden="true" />
    </div>

    <div class="actions">
      <template v-if="showAccount">
        <div ref="menuRoot" class="account-menu">
          <button
            type="button"
            class="btn ghost account-btn"
            data-testid="account-menu"
            :aria-expanded="menuOpen"
            aria-haspopup="true"
            aria-controls="account-menu-panel"
            :aria-label="menuOpen ? 'Close account menu' : `Account ${shortAddress}`"
            @click="toggleMenu"
          >
            <span class="person-wrap" aria-hidden="true">
              <UserIcon class="person-icon" />
            </span>
            <span class="addr mono">{{ shortAddress }}</span>
            <svg class="chevron" :class="{ open: menuOpen }" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M4.2 6.2 8 10l3.8-3.8"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>

          <div
            v-show="menuOpen"
            id="account-menu-panel"
            class="account-panel"
            data-testid="account-menu-panel"
          >
            <div class="panel-hero">
              <p class="panel-kicker">Balance</p>
              <p class="panel-balance mono">{{ ethDisplay ?? '—' }}</p>
              <p class="panel-network" :class="{ warn: wrongNetwork }">{{ chainLabel }}</p>
            </div>

            <div class="panel-body">
              <label class="menu-field">
                <span class="menu-label">Network</span>
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
              </label>

              <a
                v-if="faucetUrl"
                class="faucet-link"
                :class="{ copied: faucetCopied }"
                :href="faucetUrl"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="faucet-link"
                :title="`Copy address and open ${chainLabel} faucet`"
                @click="onFaucetClick"
              >
                <span class="faucet-icon" aria-hidden="true">{{ faucetCopied ? '✓' : '↗' }}</span>
                <span class="faucet-copy">
                  <span class="faucet-title">{{ faucetCopied ? 'Address copied' : faucetLabel }}</span>
                  <span class="faucet-sub">
                    {{ faucetCopied ? 'Opening faucet…' : `${chainLabel} faucet` }}
                  </span>
                </span>
              </a>

              <div class="theme-row" role="group" data-testid="theme-toggle" :aria-label="themeLabel">
                <span class="theme-copy">
                  <span class="theme-title">Appearance</span>
                  <span class="theme-hint">Auto, Light or Dark</span>
                </span>
                <div class="theme-options">
                  <button
                    v-for="opt in THEME_OPTIONS"
                    :key="opt.value"
                    type="button"
                    class="theme-option"
                    :class="{ active: themePreference === opt.value }"
                    :aria-pressed="themePreference === opt.value"
                    :data-testid="`theme-${opt.value}`"
                    @click="setThemePreference(opt.value)"
                  >
                    <span class="theme-icon" aria-hidden="true">{{ opt.icon }}</span>
                    {{ opt.label }}
                  </button>
                </div>
              </div>
            </div>

            <div class="panel-footer">
              <button
                type="button"
                class="btn ghost sign-out"
                :disabled="disconnectLoading"
                @click="onSignOut"
              >
                {{ disconnectLoading ? 'Signing out…' : 'Sign out' }}
              </button>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <span v-if="authPending" class="auth-skeleton" aria-hidden="true" />
        <button
          v-else
          type="button"
          class="btn ghost account-btn sign-in-btn"
          :disabled="signInDisabled"
          @click="onSignIn"
        >
          <span class="person-wrap" aria-hidden="true">
            <UserIcon class="person-icon" />
          </span>
          <span class="sign-in-label">
            {{
              connectLoading
                ? 'Signing in…'
                : initError
                  ? 'Sign in unavailable'
                  : 'Sign in'
            }}
          </span>
        </button>
      </template>
    </div>
  </header>
</template>

<style scoped src="./wallet-bar.css"></style>
