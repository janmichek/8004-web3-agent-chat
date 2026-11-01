<script setup lang="ts">
import { computed, ref } from 'vue'
import { scanUrlForAgent, type AgentSummary } from '@/shared/api'
import { addressExplorerUrl, networkInfo } from '@/shared/config'

type CardAgent = Pick<
  AgentSummary,
  'name' | 'description' | 'image' | 'agentId' | 'walletAddress' | 'walletChainId'
>

const props = defineProps<{
  agent: CardAgent
  /** Pre-formatted wallet balance, e.g. "0.002 ETH". Hidden when omitted. */
  balance?: string
  /** Badge in the header; the green seal on the avatar only shows for "live". */
  status?: 'live' | 'draft'
  /** Turns name, description and image into inputs (create flow, step 1). */
  editable?: boolean
  namePlaceholder?: string
  imageFileName?: string
  imageStatus?: 'idle' | 'uploading' | 'done' | 'error'
  imageError?: string
  /** Wallet that owns the identity NFT. */
  owner?: string
  /** Wallet that registers the agent. */
  creator?: string
}>()

const emit = defineEmits<{
  'update:name': [value: string]
  'update:description': [value: string]
  'image-chosen': [file: File]
  'image-removed': []
  submit: []
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

const avatarUrl = computed(() => props.agent.image || '')
const initials = computed(() => {
  const parts = props.agent.name.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (!parts.length) return 'AI'
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
})

const networkName = computed(() => networkInfo(props.agent.walletChainId).name)

function shorten(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''
}

const walletAddress = computed(() => props.agent.walletAddress ?? '')
const shortWallet = computed(() => {
  const address = walletAddress.value
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'
})
const walletScanUrl = computed(() =>
  walletAddress.value
    ? addressExplorerUrl(walletAddress.value, props.agent.walletChainId)
    : null,
)

const scanId = computed(() => {
  const agentId = props.agent.agentId
  if (!agentId) return null
  const parts = agentId.split(':')
  return parts[parts.length - 1] || agentId
})
const scanUrl = computed(() =>
  props.agent.agentId
    ? scanUrlForAgent(props.agent.agentId, props.agent.walletChainId)
    : null,
)

function pickImage() {
  fileInput.value?.click()
}

function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('image-chosen', file)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) emit('image-chosen', file)
}

function onNameInput(event: Event) {
  emit('update:name', (event.target as HTMLInputElement).value)
}

function onDescriptionInput(event: Event) {
  emit('update:description', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <div class="issued-card-wrap">
  <article class="issued-card" :class="{ editable }" data-testid="agent-card">
    <header class="issued-head">
      <span class="issued-eyebrow">Agent identity</span>
      <span v-if="status" class="issued-live" :class="status">
        <i aria-hidden="true" />{{ status === 'live' ? 'Live' : 'Draft' }}
      </span>
    </header>

    <div class="issued-body">
      <div
        class="issued-avatar"
        :class="{ photo: !!avatarUrl, pick: editable, dragging }"
        :data-testid="
          editable ? (avatarUrl ? 'create-image-preview' : 'create-image-dropzone') : undefined
        "
        :role="editable ? 'button' : undefined"
        :tabindex="editable ? 0 : undefined"
        :aria-label="editable ? (avatarUrl ? 'Change agent image' : 'Add agent image') : undefined"
        :aria-busy="editable && imageStatus === 'uploading' ? 'true' : undefined"
        @click="editable && pickImage()"
        @keydown.enter.prevent="editable && pickImage()"
        @dragover.prevent="editable && (dragging = true)"
        @dragleave.prevent="dragging = false"
        @drop.prevent="editable && onDrop($event)"
      >
        <img v-if="avatarUrl" :src="avatarUrl" :alt="imageFileName || ''" />
        <span v-else class="issued-initials">{{ initials }}</span>
        <span v-if="editable && !avatarUrl" class="avatar-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
          Image
        </span>
        <span v-if="status === 'live'" class="issued-seal" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <button
          v-if="editable && avatarUrl"
          type="button"
          class="avatar-remove"
          aria-label="Remove image"
          title="Remove image"
          data-testid="create-image-remove"
          @click.stop="emit('image-removed')"
        >
          ✕
        </button>
        <input
          v-if="editable"
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          class="visually-hidden"
          data-testid="create-image-input"
          @click.stop
          @change="onFileChosen"
        />
      </div>

      <div class="issued-info">
        <template v-if="editable">
          <input
            :value="agent.name"
            type="text"
            class="issued-name-input"
            :placeholder="namePlaceholder ?? 'my-agent'"
            aria-label="Agent name"
            spellcheck="false"
            autofocus
            data-testid="create-name-input"
            @input="onNameInput"
            @keydown.enter.prevent="emit('submit')"
          />
          <textarea
            :value="agent.description"
            class="issued-desc-input"
            rows="2"
            placeholder="What does this agent do?"
            aria-label="Description"
            data-testid="create-description-input"
            @input="onDescriptionInput"
          ></textarea>
        </template>
        <template v-else>
          <h3 class="issued-name">
            {{ agent.name }}
            <span v-if="scanId" class="issued-id mono" data-testid="agent-card-id">#{{ scanId }}</span>
          </h3>
          <span v-if="scanId" class="visually-hidden" data-testid="agent-id">#{{ scanId }}</span>
          <p v-if="agent.description" class="issued-desc">{{ agent.description }}</p>
        </template>
        <div class="issued-chips">
          <span v-if="!$slots.network" class="issued-chip" data-testid="agent-card-network">{{
            networkName
          }}</span>
        </div>
        <div v-if="$slots.network" class="issued-network" data-testid="agent-card-network">
          <slot name="network" />
        </div>
        <template v-if="editable">
          <span
            v-if="imageStatus === 'uploading'"
            class="visually-hidden"
            data-testid="create-image-uploading"
          >
            Uploading to IPFS…
          </span>
          <span
            v-else-if="imageStatus === 'error'"
            class="image-status fail"
            data-testid="create-image-error"
          >
            {{ imageError }}
          </span>
          <span
            v-else-if="avatarUrl"
            class="visually-hidden"
            data-testid="create-image-ready"
          >
            Ready — uploads when you create the agent
          </span>
        </template>
      </div>
    </div>

    <dl v-if="owner || creator" class="issued-people">
      <div v-if="owner">
        <dt class="mini-label">Owner</dt>
        <dd class="mono" :title="owner" data-testid="create-owner-address">{{ owner }}</dd>
      </div>
      <div v-if="creator">
        <dt class="mini-label">Creator</dt>
        <dd class="mono" :title="creator" data-testid="create-creator-address">
          {{ shorten(creator) }}
        </dd>
      </div>
    </dl>

    <footer class="issued-foot">
      <div class="issued-wallet">
        <span class="mini-label">Wallet</span>
        <a
          v-if="walletScanUrl"
          :href="walletScanUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="mono"
          :title="walletAddress"
          >{{ shortWallet }} ↗</a
        >
        <span v-else-if="walletAddress" class="mono" :title="walletAddress">{{ shortWallet }}</span>
        <span v-else class="mono pending">Generated on creation</span>
      </div>
      <a
        v-if="scanUrl"
        :href="scanUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="issued-scan"
      >
        View on 8004scan <span aria-hidden="true">↗</span>
      </a>
    </footer>
  </article>
  <div v-if="balance" class="issued-balance mono" data-testid="agent-card-balance">
    {{ balance }}
  </div>
  <span v-if="balance" class="visually-hidden" data-testid="agent-balance">{{ balance }}</span>
  </div>
</template>

<style scoped>
/* ---------- Issued identity card ---------- */

.issued-card-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.issued-card {
  position: relative;
  padding: 1rem 1.1rem;
  border: 1px solid color-mix(in oklab, var(--accent) 30%, var(--border));
  border-radius: 1rem;
  background:
    radial-gradient(
      120% 140% at 100% -20%,
      color-mix(in oklab, var(--accent) 20%, transparent),
      transparent 55%
    ),
    linear-gradient(
      160deg,
      color-mix(in oklab, var(--surface-2) 92%, var(--accent)),
      var(--surface-2)
    );
  box-shadow:
    0 1px 2px rgb(var(--shadow-rgb) / 0.08),
    0 22px 48px -30px var(--glow);
  animation: card-in 0.55s var(--ease-spring) both;
}

.issued-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    120deg,
    transparent 28%,
    color-mix(in oklab, #fff 9%, transparent) 44%,
    transparent 60%
  );
  pointer-events: none;
}

@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(0.7rem) scale(0.985);
  }
}

.issued-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.issued-eyebrow {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--ink) 58%, var(--muted));
}

.issued-live {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.16rem 0.5rem;
  border-radius: 2rem;
  border: 1px solid color-mix(in oklab, var(--ok-ink) 30%, transparent);
  background: color-mix(in oklab, var(--ok-ink) 11%, transparent);
  color: var(--ok-ink);
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.issued-live i {
  width: 0.36rem;
  height: 0.36rem;
  border-radius: 50%;
  background: var(--ok-ink);
  animation: live-pulse 1.9s ease-out infinite;
}

@keyframes live-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--ok-ink) 55%, transparent);
  }
  70%,
  100% {
    box-shadow: 0 0 0 0.32rem transparent;
  }
}

.issued-body {
  display: grid;
  grid-template-columns: 6rem minmax(0, 1fr);
  gap: 1.1rem;
  align-items: center;
  margin-top: 0.85rem;
}

.issued-avatar {
  position: relative;
  display: grid;
  place-items: center;
  width: 6rem;
  aspect-ratio: 1;
  border-radius: 1rem;
  background: linear-gradient(
    135deg,
    color-mix(in oklab, var(--accent) 84%, #fff),
    color-mix(in oklab, var(--accent) 42%, #7b5cff)
  );
  color: var(--on-accent);
  box-shadow:
    0 16px 32px -18px var(--glow),
    0 0 0 5px color-mix(in oklab, var(--accent) 10%, transparent);
}

.issued-avatar.photo {
  background: var(--surface);
}

.issued-avatar img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.issued-initials {
  font-family: var(--font-display);
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.issued-seal {
  position: absolute;
  right: -0.3rem;
  bottom: -0.3rem;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  border: 2px solid var(--surface-2);
  background: var(--ok-ink);
  color: #fff;
  box-shadow: 0 4px 10px rgb(var(--shadow-rgb) / 0.35);
}

.issued-seal svg {
  width: 0.8rem;
  height: 0.8rem;
}

.issued-info {
  min-width: 0;
}

.issued-name {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.15;
  word-break: break-word;
}

.issued-name-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.issued-id {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--muted);
}

.issued-balance {
  font-size: 0.78rem;
  color: var(--ink);
}

.issued-desc {
  display: -webkit-box;
  margin: 0.2rem 0 0;
  overflow: hidden;
  font-size: 0.79rem;
  line-height: 1.45;
  color: var(--muted);
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.issued-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.55rem;
}

.issued-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.12rem 0.45rem;
  border-radius: 2rem;
  border: 1px solid var(--border);
  background: color-mix(in oklab, var(--surface) 70%, transparent);
  color: var(--muted);
  font-size: 0.66rem;
  font-weight: 600;
  white-space: nowrap;
}

.issued-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 1rem;
  padding-top: 0.8rem;
  border-top: 1px dashed color-mix(in oklab, var(--accent) 22%, var(--border));
}

.issued-wallet {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
}

.issued-wallet a,
.issued-wallet .mono {
  overflow: hidden;
  font-size: 0.72rem;
  color: var(--ink);
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issued-wallet a:hover {
  color: var(--accent);
}

.issued-scan {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  padding: 0.35rem 0.65rem;
  border-radius: 2rem;
  border: 1px solid color-mix(in oklab, var(--accent) 35%, transparent);
  background: color-mix(in oklab, var(--accent) 9%, transparent);
  color: var(--accent);
  font-size: 0.7rem;
  font-weight: 650;
  text-decoration: none;
  transition: background 0.16s ease, transform 0.16s var(--ease-spring);
}

.issued-scan:hover {
  background: color-mix(in oklab, var(--accent) 15%, transparent);
  transform: translateY(-1px);
}

.mini-label {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}

.issued-wallet .pending {
  color: var(--muted);
  font-style: italic;
}

.issued-live.draft {
  border-color: var(--border);
  background: transparent;
  color: var(--muted);
}

.issued-live.draft i {
  background: var(--muted);
  animation: none;
}

/* ---------- Editable ---------- */

.issued-avatar.pick {
  cursor: pointer;
  outline: none;
  transition: transform 0.16s var(--ease-spring);
}

.issued-avatar.pick:hover,
.issued-avatar.pick.dragging {
  transform: scale(1.03);
}

.issued-avatar.pick:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 55%, transparent);
}

.avatar-hint {
  position: absolute;
  inset: auto 0 0.35rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.85;
}

.avatar-hint svg {
  width: 0.7rem;
  height: 0.7rem;
}

.avatar-remove {
  position: absolute;
  top: -0.35rem;
  right: -0.35rem;
  display: grid;
  place-items: center;
  width: 1.4rem;
  height: 1.4rem;
  padding: 0;
  border: 2px solid var(--surface-2);
  border-radius: 50%;
  background: var(--ink);
  color: var(--bg);
  font-size: 0.6rem;
  cursor: pointer;
}

.issued-name-input,
.issued-desc-input {
  display: block;
  width: 100%;
  margin: 0;
  border: 0;
  border-bottom: 1px solid color-mix(in oklab, var(--accent) 45%, var(--border));
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  transition: border-color 0.16s ease;
}

.issued-name-input {
  padding: 0 0 0.1rem;
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.15;
}

.issued-desc-input {
  margin-top: 0.2rem;
  padding: 0;
  resize: none;
  font: inherit;
  font-size: 0.79rem;
  line-height: 1.45;
}

.issued-name-input:hover,
.issued-desc-input:hover {
  border-bottom-color: var(--accent);
}

.issued-name-input:focus,
.issued-desc-input:focus {
  outline: none;
  border-bottom-color: var(--accent);
  box-shadow: none;
}

.issued-name-input::placeholder,
.issued-desc-input::placeholder {
  color: color-mix(in oklab, var(--muted) 70%, transparent);
}

.issued-network {
  margin-top: 0.55rem;
}

.issued-people {
  display: grid;
  gap: 0.5rem;
  margin: 0.9rem 0 0;
  padding-top: 0.8rem;
  border-top: 1px dashed color-mix(in oklab, var(--accent) 22%, var(--border));
}

.issued-people > div {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  min-width: 0;
}

.issued-people dt {
  flex: 0 0 3.6rem;
}

.issued-people dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 0.74rem;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-status {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.72rem;
  color: var(--muted);
  word-break: break-all;
}

.image-status.fail {
  color: var(--danger-ink);
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
  .issued-body {
    grid-template-columns: 4rem minmax(0, 1fr);
    gap: 0.75rem;
  }

  .issued-avatar {
    width: 4rem;
    border-radius: 0.8rem;
  }

  .issued-initials {
    font-size: 1.25rem;
  }

  .issued-foot {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
