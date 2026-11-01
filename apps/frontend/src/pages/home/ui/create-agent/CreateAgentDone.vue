<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from 'vue'
import type { AgentSummary } from '@/shared/api'
import { networkInfo } from '@/shared/config'
import AgentCard from '../agent-card/AgentCard.vue'
import { useAgentFunding } from '../../model/use-agent-funding'

const props = defineProps<{
  agent: AgentSummary
  balance: string
  imageUrl?: string
  privateKey?: string
  privateKeyEnvVar?: string
  ephemeralWarning?: string
}>()

const emit = defineEmits<{
  'open-chat': []
  close: []
}>()

const balance = ref(props.balance)
const agentRef = toRef(props, 'agent')
const {
  fundEth,
  fundBusy,
  fundStatus,
  fundStatusKind,
  fundAmountValid,
  funded,
  fundButtonLabel,
  networkName,
  fundTxUrl,
  fundFromMaster,
  fundFromWallet,
} = useAgentFunding(agentRef, balance)

const cardAgent = computed(() => ({
  ...props.agent,
  image: props.agent.image || props.imageUrl || undefined,
}))

const networkShortName = computed(() => networkInfo(props.agent.walletChainId).shortName)

const openStepRef = ref<HTMLElement | null>(null)
watch(funded, async (isFunded) => {
  if (!isFunded) return
  await nextTick()
  openStepRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})

const privateKeyVisible = ref(false)
const privateKeyCopied = ref(false)

async function copyPrivateKey() {
  if (!props.privateKey) return
  try {
    await navigator.clipboard.writeText(props.privateKey)
    privateKeyCopied.value = true
    setTimeout(() => (privateKeyCopied.value = false), 2000)
  } catch {
    // Clipboard API unavailable (non-secure context) — the key stays selectable.
    privateKeyCopied.value = false
  }
}
</script>

<template>
  <div class="body done" data-testid="create-done">
    <p class="done-kicker">
      <span class="kicker-check" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <strong>Agent created</strong>
      <span>· live on {{ networkName }}</span>
    </p>

    <AgentCard
      :agent="cardAgent"
      :balance="`${balance} ETH`"
      status="live"
    />

    <ol class="flow">
      <li
        class="flow-step"
        :class="{ active: !funded, done: funded }"
        data-testid="create-fund-panel"
      >
        <span class="flow-dot">
          <svg v-if="funded" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3.5 8.5l3 3 6-7"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <template v-else>1</template>
        </span>

        <div class="flow-body">
          <div class="flow-head">
            <div>
              <p class="flow-title">Fund wallet</p>
              <p class="flow-sub">
                {{
                  funded
                    ? 'Wallet funded — ready to chat.'
                    : 'A little ETH covers gas for its first jobs.'
                }}
              </p>
            </div>
            <span v-if="funded" class="flow-tag">Done</span>
          </div>

          <form class="fund-form" @submit.prevent="fundFromWallet">
            <label class="fund-field">
              <span class="visually-hidden">Amount in ETH</span>
              <input
                v-model="fundEth"
                type="text"
                inputmode="decimal"
                placeholder="0.002"
                spellcheck="false"
                data-testid="create-fund-amount"
                :disabled="fundBusy !== null"
              />
              <span class="fund-token" data-testid="create-fund-currency" :title="networkName">
                ETH<span class="fund-net" data-testid="create-fund-network">
                  · {{ networkShortName }}
                </span>
              </span>
            </label>
            <button
              type="submit"
              class="btn primary fund-btn"
              data-testid="create-fund-wallet"
              :disabled="!fundAmountValid || fundBusy !== null"
            >
              <span v-if="fundBusy !== null" class="fund-spin" aria-hidden="true" />
              {{ fundButtonLabel }}
            </button>
          </form>

          <div class="fund-row">
            <button
              type="button"
              class="fund-alt"
              data-testid="create-fund-master"
              :disabled="!fundAmountValid || fundBusy !== null"
              @click="fundFromMaster"
            >
              {{ fundBusy === 'master' ? 'Sending…' : 'Use test funds instead' }}
            </button>
            <a
              v-if="fundTxUrl"
              :href="fundTxUrl"
              class="fund-tx-link"
              target="_blank"
              rel="noopener"
              data-testid="create-fund-tx-link"
              >View tx ↗</a
            >
          </div>

          <p
            v-if="fundStatus && fundStatusKind === 'error'"
            class="fund-state error"
            data-testid="create-fund-status"
            role="alert"
          >
            {{ fundStatus }}
          </p>
        </div>
      </li>

      <li ref="openStepRef" class="flow-step" :class="{ active: funded }">
        <span class="flow-dot">2</span>
        <div class="flow-body">
          <div class="flow-head">
            <div>
              <p class="flow-title">Open chat</p>
              <p class="flow-sub">
                {{
                  funded
                    ? 'Funded and ready. Say hello.'
                    : 'You can chat now and top up later.'
                }}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="btn open-chat-btn"
            :class="funded ? 'primary' : 'ghost'"
            @click="emit('open-chat')"
          >
            Open chat
          </button>
        </div>
      </li>
    </ol>

    <details v-if="privateKey" class="advanced" data-testid="create-ephemeral-key">
      <summary>
        Agent private key
        <span>save once</span>
      </summary>
      <div class="advanced-body">
        <p class="advanced-title">Shown only once — store it somewhere safe.</p>
        <p v-if="ephemeralWarning" class="advanced-hint">{{ ephemeralWarning }}</p>
        <p v-if="privateKeyEnvVar" class="advanced-hint mono">
          Vercel → Environment Variables: {{ privateKeyEnvVar }}
        </p>
        <div class="key-row">
          <code class="mono key-value" data-testid="create-private-key-value">{{
            privateKeyVisible ? privateKey : '•'.repeat(48)
          }}</code>
          <button
            type="button"
            class="btn ghost small"
            @click="privateKeyVisible = !privateKeyVisible"
          >
            {{ privateKeyVisible ? 'Hide' : 'Show' }}
          </button>
          <button
            type="button"
            class="btn ghost small"
            data-testid="create-private-key-copy"
            @click="copyPrivateKey"
          >
            {{ privateKeyCopied ? 'Copied!' : 'Copy' }}
          </button>
        </div>
      </div>
    </details>

    <div class="done-actions">
      <button type="button" class="btn ghost" @click="emit('close')">Close</button>
    </div>
  </div>
</template>

<style scoped>
.done {
  gap: 1rem;
}

.done-kicker {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
}

.done-kicker strong {
  font-family: var(--font-display);
  font-size: 0.98rem;
  font-weight: 650;
  color: var(--ink);
}

.kicker-check {
  display: grid;
  place-items: center;
  width: 1.15rem;
  height: 1.15rem;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--ok-ink);
  color: #fff;
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--ok-ink) 12%, transparent);
}

.kicker-check svg {
  width: 0.7rem;
  height: 0.7rem;
}

/* ---------- Guided steps ---------- */

.flow {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.flow-step {
  position: relative;
  display: grid;
  grid-template-columns: 1.6rem minmax(0, 1fr);
  gap: 0.7rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border);
  border-radius: 0.85rem;
  background: var(--surface-2);
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}

.flow-step.active {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
  background: color-mix(in oklab, var(--accent) 5%, var(--surface-2));
  box-shadow: 0 14px 34px -26px var(--glow);
}

.flow-step.done {
  border-color: color-mix(in oklab, var(--ok-ink) 32%, var(--border));
}

.flow-dot {
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
  transition:
    color 0.2s ease,
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.flow-dot svg {
  width: 0.8rem;
  height: 0.8rem;
}

.flow-step.active .flow-dot {
  border-color: transparent;
  background: linear-gradient(
    135deg,
    var(--accent),
    color-mix(in oklab, var(--accent) 60%, #7b5cff)
  );
  color: var(--on-accent);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 14%, transparent);
}

.flow-step.done .flow-dot {
  border-color: color-mix(in oklab, var(--ok-ink) 38%, var(--border));
  background: color-mix(in oklab, var(--ok-ink) 12%, var(--surface));
  color: var(--ok-ink);
}

.flow-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}

.flow-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.flow-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 0.92rem;
  font-weight: 600;
}

.flow-sub {
  margin: 0.12rem 0 0;
  font-size: 0.74rem;
  line-height: 1.4;
  color: var(--muted);
}

.flow-tag {
  flex-shrink: 0;
  padding: 0.12rem 0.42rem;
  border-radius: 2rem;
  border: 1px solid color-mix(in oklab, var(--ok-ink) 30%, transparent);
  background: color-mix(in oklab, var(--ok-ink) 11%, transparent);
  color: var(--ok-ink);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

/* ---------- Funding ---------- */

.fund-form {
  display: flex;
  align-items: stretch;
  gap: 0.45rem;
}

.fund-field {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex: 1;
  min-width: 0;
  padding: 0 0.7rem;
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  background: var(--bg);
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    opacity 0.16s ease;
}

.fund-field:focus-within {
  border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 15%, transparent);
}

.fund-field:has(input:disabled) {
  opacity: 0.6;
}

.fund-field input {
  flex: 1;
  min-width: 0;
  padding: 0.55rem 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.95rem;
}

.fund-field input:focus {
  outline: none;
}

.fund-token {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
}

.fund-net {
  margin-left: 0.3rem;
  font-weight: 500;
  color: color-mix(in oklab, var(--muted) 80%, transparent);
}

.fund-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: 0.4rem;
  min-width: 9.5rem;
  white-space: nowrap;
}

.fund-spin {
  width: 0.8rem;
  height: 0.8rem;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: fund-spin 0.8s linear infinite;
}

@keyframes fund-spin {
  to {
    transform: rotate(360deg);
  }
}

.fund-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.fund-alt {
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  text-align: left;
  text-decoration: underline;
  text-decoration-color: color-mix(in oklab, var(--muted) 45%, transparent);
  text-underline-offset: 2px;
  cursor: pointer;
  transition: color 0.16s ease;
}

.fund-alt:hover:not(:disabled) {
  color: var(--accent);
}

.fund-alt:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fund-tx-link {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
}

.fund-tx-link:hover {
  text-decoration: underline;
}

.fund-state {
  margin: 0;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: color-mix(in oklab, var(--surface) 62%, transparent);
  color: var(--muted);
  font-size: 0.74rem;
  line-height: 1.4;
  word-break: break-word;
}

.fund-state.error {
  border-color: color-mix(in oklab, var(--danger-base) 35%, var(--border));
  background: color-mix(in oklab, var(--danger-base) 10%, transparent);
  color: var(--danger-ink);
}

.open-chat-btn {
  align-self: flex-start;
}

/* ---------- Private key disclosure ---------- */

.advanced {
  overflow: hidden;
  border: 1px solid color-mix(in oklab, var(--danger-base) 38%, var(--border));
  border-radius: 0.75rem;
  background: color-mix(in oklab, var(--danger-base) 6%, var(--surface-2));
}

.advanced > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.7rem 0.9rem;
  font-size: 0.76rem;
  font-weight: 650;
  color: var(--danger-ink);
  cursor: pointer;
  list-style: none;
}

.advanced > summary::-webkit-details-marker {
  display: none;
}

.advanced > summary span {
  font-size: 0.66rem;
  font-weight: 500;
  color: var(--muted);
}

.advanced[open] > summary {
  border-bottom: 1px solid color-mix(in oklab, var(--danger-base) 28%, var(--border));
}

.advanced-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.8rem 0.9rem;
}

.advanced-title {
  margin: 0;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--danger-ink);
}

.advanced-hint {
  margin: 0;
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--muted);
  word-break: break-all;
}

.key-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.key-value {
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
  background: var(--bg);
  color: var(--ink);
  font-size: 0.72rem;
  word-break: break-all;
}

.done-actions {
  display: flex;
  justify-content: flex-end;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 560px) {
  .fund-form {
    flex-direction: column;
  }

  .fund-btn,
  .open-chat-btn {
    width: 100%;
  }
}
</style>
