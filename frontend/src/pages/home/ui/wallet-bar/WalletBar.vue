<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue'
import { useAccount, useBalance, useConfig, useSwitchChain } from '@wagmi/vue'
import { useWeb3Auth, useWeb3AuthConnect, useWeb3AuthDisconnect } from '@web3auth/modal/vue'
import { formatEther } from 'viem'
import { ensureChain, getInjectedChainId } from '@/shared/lib'
import { theme, toggleTheme } from '@/shared/lib'
import { SUPPORTED_NETWORKS, findNetwork, isSupportedChain } from '@/shared/config'

const wagmiConfig = useConfig()
const { address, chainId: accountChainId, status: accountStatus } = useAccount()
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
        <img class="mark" src="/logo-light.svg" alt="Web3 Agent Chat logo" width="32" height="32" />
      </div>
      <div>
        <p class="name">Web3 Agent Chat</p>
      </div>
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
              <svg class="person-icon" viewBox="0 0 24 24" focusable="false">
                <circle cx="12" cy="8" r="3.25" fill="none" stroke="currentColor" stroke-width="1.75" />
                <path
                  d="M5.5 19.25c.9-3.2 3.1-4.75 6.5-4.75s5.6 1.55 6.5 4.75"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                />
              </svg>
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
                :href="faucetUrl"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="faucet-link"
                :title="`Open ${chainLabel} faucet`"
              >
                <span class="faucet-icon" aria-hidden="true">↗</span>
                <span class="faucet-copy">
                  <span class="faucet-title">{{ faucetLabel }}</span>
                  <span class="faucet-sub">{{ chainLabel }} faucet</span>
                </span>
              </a>

              <button
                type="button"
                class="theme-row"
                data-testid="theme-toggle"
                :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
                @click="toggleTheme"
              >
                <span class="theme-icon" aria-hidden="true">{{ theme === 'dark' ? '☀' : '☾' }}</span>
                <span class="theme-copy">
                  <span class="theme-title">Appearance</span>
                  <span class="theme-sub">{{ theme === 'dark' ? 'Dark' : 'Light' }}</span>
                </span>
                <span class="theme-switch" :data-mode="theme" aria-hidden="true">
                  <span class="theme-knob" />
                </span>
              </button>
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
        <button
          type="button"
          class="btn ghost theme-btn"
          data-testid="theme-toggle"
          :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          :title="theme === 'dark' ? 'Light mode' : 'Dark mode'"
          @click="toggleTheme"
        >
          {{ theme === 'dark' ? '☀' : '☾' }}
        </button>
        <span v-if="authPending" class="auth-skeleton" aria-hidden="true" />
        <button
          v-else
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

/* Elevate the sticky bar stacking context so .account-panel clears app drawers/dialogs. */
.bar.menu-open {
  z-index: 100;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}

.brand-mark {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  flex-shrink: 0;
}

.mark:hover {
  transform: rotate(-8deg) scale(1.12);
}

.mark {
  transition: transform 0.35s var(--ease-spring);
  width: 2rem;
  height: 2rem;
  border-radius: 0.4rem;
  object-fit: contain;
  display: block;
  flex-shrink: 0;
}

.name {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.05rem;
  letter-spacing: -0.02em;
}

.theme-btn {
  padding: 0.45rem 0.65rem;
  line-height: 1;
}

.auth-skeleton {
  display: inline-block;
  width: 8rem;
  height: 2.35rem;
  border-radius: 999px;
  background: linear-gradient(
    100deg,
    color-mix(in oklab, var(--surface-2) 92%, var(--border)) 30%,
    color-mix(in oklab, var(--surface-2) 60%, var(--border)) 50%,
    color-mix(in oklab, var(--surface-2) 92%, var(--border)) 70%
  );
  background-size: 220% 100%;
  animation: auth-skeleton 1.4s ease-in-out infinite;
}

@keyframes auth-skeleton {
  from {
    background-position: 180% 0;
  }
  to {
    background-position: -80% 0;
  }
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.account-menu {
  position: relative;
}

.account-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  height: 2.35rem;
  padding: 0 0.7rem 0 0.35rem;
  border-radius: 999px;
}

.account-btn[aria-expanded='true'] {
  background: var(--surface-2);
  border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 14%, transparent);
}

.person-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 999px;
  background: color-mix(in oklab, var(--accent) 14%, var(--surface-2));
  color: var(--accent);
  flex-shrink: 0;
}

.person-icon {
  width: 1rem;
  height: 1rem;
  display: block;
}

.addr {
  position: relative;
  display: inline-flex;
  align-items: center;
  font-size: 0.84rem;
  color: var(--ink);
  letter-spacing: -0.01em;
}

.addr::before {
  content: '';
  display: inline-block;
  width: 0.4rem;
  height: 0.4rem;
  margin-right: 0.4rem;
  border-radius: 50%;
  background: #3ddc97;
  box-shadow: 0 0 0 0 #3ddc9788;
  animation: online 2.2s ease-out infinite;
}

@keyframes online {
  70% { box-shadow: 0 0 0 6px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

.chevron {
  width: 0.85rem;
  height: 0.85rem;
  color: var(--muted);
  transition: transform 0.2s var(--ease-out);
  flex-shrink: 0;
}

.chevron.open {
  transform: rotate(180deg);
  color: var(--accent);
}

.account-panel {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  width: min(17.5rem, calc(100vw - 1.5rem));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 0.15rem);
  background: var(--surface);
  box-shadow:
    0 18px 40px -18px rgb(var(--shadow-rgb) / 0.45),
    0 0 0 1px color-mix(in oklab, var(--accent) 8%, transparent);
  animation: menu-in 0.22s var(--ease-out);
  transform-origin: top right;
}

@keyframes menu-in {
  from {
    opacity: 0;
    transform: translateY(-0.4rem) scale(0.98);
  }
}

.panel-hero {
  padding: 0.95rem 1rem 0.85rem;
  background:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, var(--accent) 16%, transparent), transparent 55%),
    linear-gradient(180deg, color-mix(in oklab, var(--surface-2) 70%, transparent), transparent);
  border-bottom: 1px solid var(--border);
}

.panel-kicker {
  margin: 0 0 0.2rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.panel-balance {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 500;
  color: var(--ink);
  letter-spacing: -0.02em;
}

.panel-network {
  margin: 0.35rem 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.panel-network.warn {
  color: var(--warn);
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
}

.menu-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.menu-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.chip {
  font: inherit;
  font-size: 0.84rem;
  width: 100%;
  padding: 0.55rem 0.7rem;
  border-radius: 0.45rem;
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

.faucet-link {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--surface-2);
  color: var(--ink);
  text-decoration: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.faucet-link:hover {
  border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
  background: color-mix(in oklab, var(--accent) 6%, var(--surface-2));
}

.faucet-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 0.4rem;
  background: color-mix(in oklab, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 0.85rem;
  line-height: 1;
}

.faucet-copy {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}

.faucet-title {
  font-size: 0.84rem;
  font-weight: 600;
}

.faucet-sub {
  font-size: 0.72rem;
  color: var(--muted);
}

.theme-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.theme-row:hover {
  border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
  background: color-mix(in oklab, var(--accent) 6%, var(--surface-2));
}

.theme-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 0.4rem;
  background: color-mix(in oklab, var(--accent) 12%, transparent);
  line-height: 1;
}

.theme-copy {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}

.theme-title {
  font-size: 0.84rem;
  font-weight: 600;
}

.theme-sub {
  font-size: 0.72rem;
  color: var(--muted);
}

.theme-switch {
  position: relative;
  width: 2.1rem;
  height: 1.2rem;
  border-radius: 999px;
  background: color-mix(in oklab, var(--muted) 35%, var(--border));
  flex-shrink: 0;
  transition: background 0.2s ease;
}

.theme-switch[data-mode='dark'] {
  background: color-mix(in oklab, var(--accent) 55%, var(--border));
}

.theme-knob {
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
  transition: transform 0.2s var(--ease-out);
}

.theme-switch[data-mode='dark'] .theme-knob {
  transform: translateX(0.9rem);
}

.panel-footer {
  padding: 0 1rem 1rem;
}

.sign-out {
  width: 100%;
  justify-content: center;
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
}
</style>
