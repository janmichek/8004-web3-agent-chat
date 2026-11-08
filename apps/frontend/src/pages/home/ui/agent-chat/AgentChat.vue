<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { chatWithAgent, extractSuccessfulTxHash, type AgentSummary, type ChatEvent, type MemorySession } from '@/shared/api'
import RateAgent from './RateAgent.vue'
import ChatComposer from './ChatComposer.vue'

marked.setOptions({ breaks: true, gfm: true })

function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
  return clean.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ')
}

type Bubble =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'event'; event: ChatEvent }
  | { kind: 'rate'; txHash: string; tag: string; endpoint: string }
  | { kind: 'error'; text: string }

const props = defineProps<{
  agent?: AgentSummary | null
  /** @deprecated use `agent` */
  agentName?: string | null
  recalledSession?: MemorySession | null
  /** Increment to remount bubbles and replay pop-in without reloading the session. */
  replayKey?: number
  /** Increment to clear the thread (live or recalled) for a new chat. */
  newChatKey?: number
  /** Until true, the no-agent hint is hidden so it can't flash before the list loads. */
  agentsLoaded?: boolean
}>()

const emit = defineEmits<{
  chat: []
}>()

const resolvedName = (): string | null => {
  if (props.agent?.name) return props.agent.name
  if (props.agentName) return props.agentName
  return null
}

const input = ref('')
const busy = ref(false)
const bubbles = ref<Bubble[]>([])
const scroller = ref<HTMLElement | null>(null)
const animEpoch = ref(0)

/**
 * The dock holds the composer once the hero is gone: after the first bubble,
 * or when there is no agent yet (disabled, with the "select an agent" hint).
 * Keeping it mounted means the input never disappears from the bottom.
 */
const showDock = computed(
  () => bubbles.value.length > 0 || (!!props.agentsLoaded && !resolvedName()),
)

watch(
  () => props.replayKey,
  (key, prev) => {
    if (key == null || key === prev) return
    animEpoch.value += 1
  },
)

watch(
  () => props.newChatKey,
  (key, prev) => {
    if (key == null || key === prev) return
    bubbles.value = []
    input.value = ''
    animEpoch.value += 1
  },
)

watch(
  () => props.agent?.name ?? props.agentName,
  () => {
    bubbles.value = []
  },
)

watch(
  () => bubbles.value.length,
  () => {
    void scrollBottom()
  },
)

watch(
  () => props.recalledSession,
  (session) => {
    if (!session) {
      bubbles.value = []
      return
    }
    void recallSession(session)
  },
)

async function recallSession(session: MemorySession) {
  bubbles.value = []
  for (const m of session.messages) {
    if (m.role === 'user') {
      bubbles.value.push({ kind: 'user', text: m.content })
    } else if (m.role === 'assistant') {
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          bubbles.value.push({ kind: 'event', event: { type: 'tool_call', name: tc.name, args: tc.args } })
        }
      }
      if (m.content && m.content.trim()) {
        bubbles.value.push({ kind: 'agent', text: m.content })
      } else if (!m.toolCalls?.length) {
        // empty assistant message without tool calls -> skip
      }
    } else if (m.role === 'tool') {
      bubbles.value.push({ kind: 'event', event: { type: 'tool_result', content: m.content } })
    } else if (m.role === 'system' && m.content.trim()) {
      bubbles.value.push({ kind: 'agent', text: m.content })
    }
  }
  await scrollBottom()
}

async function send() {
  const text = input.value.trim()
  const name = resolvedName()
  if (!text || !name || busy.value) return

  bubbles.value.push({ kind: 'user', text })
  input.value = ''
  busy.value = true
  await scrollBottom()

  try {
    const res = await chatWithAgent(name, text)
    let lastSuccessTx: string | null = null
    let sawSuccessfulTool = false
    const toolNames: string[] = []
    for (const event of res.events) {
      if (event.type === 'message') {
        bubbles.value.push({ kind: 'agent', text: event.content })
      } else {
        bubbles.value.push({ kind: 'event', event })
        if (event.type === 'tool_call') {
          toolNames.push(event.name)
        }
        if (event.type === 'tool_result') {
          const tx = extractSuccessfulTxHash(event.content)
          if (tx) lastSuccessTx = tx
          // Any non-error tool output counts as a successful interaction,
          // including reads like fetch_contract_abi / get_token_balance
          // which never produce a tx hash.
          if (!/^\s*Error:/i.test(event.content)) {
            sawSuccessfulTool = true
          }
        }
      }
    }
    if (!res.events.some((e) => e.type === 'message') && res.reply) {
      bubbles.value.push({ kind: 'agent', text: res.reply })
    }
    // Don't re-prompt for a rating right after the user just submitted one.
    const onlyFeedbackTools =
      toolNames.length > 0 && toolNames.every((n) => n === 'give_feedback' || n === 'get_reputation')
    if (sawSuccessfulTool && !onlyFeedbackTools && props.agent?.agentId) {
      bubbles.value.push({
        kind: 'rate',
        txHash: lastSuccessTx ?? '',
        tag: tagForTools(toolNames),
        endpoint: endpointForTools(name, toolNames),
      })
    }
    emit('chat')
  } catch (err) {
    bubbles.value.push({
      kind: 'error',
      text: err instanceof Error ? err.message : String(err),
    })
    emit('chat')
  } finally {
    busy.value = false
    await scrollBottom()
  }
}

function tagForTools(toolNames: string[]): string {
  // Ratings are always quality (tag1='starred'); this is tag2 context.
  const pick = toolNames.find((n) => n !== 'give_feedback' && n !== 'get_reputation') ?? ''
  if (pick === 'send_eth') return 'transfer'
  if (pick === 'get_token_balance') return 'balance'
  if (pick === 'fetch_contract_abi') return 'contract-abi'
  if (pick === 'call_contract') return 'contract-call'
  return 'execution'
}

function endpointForTools(agentName: string, toolNames: string[]): string {
  // Full service URL the rating applies to — origin-aware so localhost
  // and Vercel deployments record their own address.
  // e.g. http://localhost:5174/api/agents/demo/chat#get_token_balance
  const pick = toolNames.find((n) => n !== 'give_feedback' && n !== 'get_reputation') ?? ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const base = `${origin}/api/agents/${encodeURIComponent(agentName)}/chat`
  return pick ? `${base}#${pick}` : base
}

async function scrollBottom() {
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  const el = scroller.value
  if (el) {
    el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
    // Fallback for browsers where scrollTo is clamped before layout settles
    el.scrollTop = el.scrollHeight
  }
}

</script>

<template>
  <section class="chat">
    <div ref="scroller" class="thread" role="log" aria-live="polite" data-testid="chat-thread">
      <p v-if="!resolvedName() && agentsLoaded" class="empty" data-testid="chat-empty-no-agent">
        Select an agent on the left to start — or create a new one.
      </p>
      <section v-else-if="resolvedName() && !bubbles.length" class="welcome" data-testid="chat-empty">
        <p class="welcome-sub">Check balances, resolve ENS names, and call contracts on-chain.</p>
        <ChatComposer
          v-model="input"
          variant="hero"
          placeholder="Ask about agents, wallets, or on-chain actions…"
          :no-agent="!resolvedName()"
          @submit="send"
        />
        <div class="welcome-chips">
          <button type="button" class="chip" @click="input = 'What is the ETH balance of 0x0000000000000000000000000000000000000000?'; send()">
            What is the ETH balance of an address?
          </button>
          <button type="button" class="chip" @click="input = 'Send 0.01 ETH to 0x0000000000000000000000000000000000000000'; send()">
            Send 0.01 ETH to an address
          </button>
          <button type="button" class="chip" @click="input = 'What does the contract at 0x0000000000000000000000000000000000000000 do?'; send()">
            Explain a contract's ABI
          </button>
        </div>
      </section>

      <template v-for="(b, i) in bubbles" :key="`${animEpoch}-${i}`">
        <div v-if="b.kind === 'user'" class="bubble user md" data-testid="chat-bubble-user" v-html="renderMarkdown(b.text)"></div>
        <div v-else-if="b.kind === 'agent'" class="bubble agent md" data-testid="chat-bubble-agent" v-html="renderMarkdown(b.text)"></div>
        <div v-else-if="b.kind === 'error'" class="bubble error" data-testid="chat-bubble-error">{{ b.text }}</div>
        <div v-else-if="b.kind === 'rate' && agent?.agentId" class="rate-wrap">
          <RateAgent
            :agent-name="agent.name"
            :default-agent-id="agent.agentId"
            :wallet-chain-id="agent.walletChainId"
            :owners="agent.owners"
            :operators="agent.operators"
            :initial-tag="b.tag"
            :initial-endpoint="b.endpoint"
          />
        </div>
        <div v-else-if="b.kind === 'event'" class="event mono" data-testid="chat-event">
          <template v-if="b.event.type === 'tool_call'">
            → {{ b.event.name }} {{ JSON.stringify(b.event.args) }}
          </template>
          <template v-else-if="b.event.type === 'tool_result'">
            ← {{ b.event.content }}
          </template>
        </div>
      </template>

      <div v-if="busy" class="typing" data-testid="chat-busy">
        <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
        Agent thinking…
      </div>
    </div>

    <div v-if="showDock" class="dock">
      <ChatComposer
        v-model="input"
        :placeholder="resolvedName() ? 'Message the agent…' : 'Select an agent first…'"
        :no-agent="!resolvedName()"
        :busy="busy"
        @submit="send"
      />
    </div>
  </section>
</template>

<style scoped>
.chat {
  /* Grid instead of flex: the thread row absorbs all leftover height and the
     dock row is always the last thing in the box, so the composer can never
     float above empty space (or get pushed off-screen) as bubbles arrive. */
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}

.thread {
  grid-row: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  background:
    radial-gradient(ellipse at top left, color-mix(in oklab, var(--accent) 8%, transparent), transparent 50%),
    var(--bg);
}

.empty {
  margin: auto;
  max-width: 22rem;
  text-align: center;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1rem 0.25rem;
  margin: auto;
  text-align: center;
}

.welcome-sub {
  margin: 0;
  max-width: 36rem;
  color: var(--muted);
  font-size: 0.86rem;
  line-height: 1.5;
}

.welcome-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
  margin-top: 1.1rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.6rem;
  border-radius: 2rem;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink);
  font-size: 0.74rem;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}

.chip {
  transition: transform 0.2s var(--ease-spring), border-color 0.15s ease, background 0.15s ease, box-shadow 0.2s ease;
  animation: chip-in 0.5s var(--ease-out) both;
}
.chip:nth-child(2) { animation-delay: 0.06s; }
.chip:nth-child(3) { animation-delay: 0.12s; }
.chip:nth-child(4) { animation-delay: 0.18s; }
.chip:nth-child(5) { animation-delay: 0.24s; }
.chip:nth-child(6) { animation-delay: 0.3s; }
.chip:hover {
  border-color: var(--accent);
  background: color-mix(in oklab, var(--accent) 10%, var(--surface));
  transform: translateY(-2px) rotate(-1deg);
  box-shadow: 0 6px 16px -8px var(--glow);
}
.chip:active {
  transform: scale(0.95);
}
@keyframes chip-in {
  from { opacity: 0; transform: translateY(0.6rem) scale(0.94); }
}

.welcome-sub::before {
  content: '⬡';
  display: block;
  margin-bottom: 0.4rem;
  font-size: 2rem;
  line-height: 1;
  color: var(--accent);
  filter: drop-shadow(0 0 12px var(--glow));
  animation: float 4s ease-in-out infinite;
}
@keyframes float {
  50% { transform: translateY(-6px) rotate(8deg); }
}

.dock {
  grid-row: 2;
  flex: none;
  padding-top: 0.15rem;
}

.bubble {
  animation: pop-in 0.38s var(--ease-spring) both;
  transform-origin: bottom left;
}
.bubble.user {
  transform-origin: bottom right;
  box-shadow: 0 6px 18px -8px var(--glow);
  border-bottom-right-radius: 0.15rem;
}
.bubble.agent {
  border-bottom-left-radius: 0.15rem;
}
.bubble.error {
  animation: pop-in 0.38s var(--ease-spring) both, shake 0.4s 0.1s ease;
}
.event {
  animation: fade-in 0.4s ease both;
}
@keyframes pop-in {
  from { opacity: 0; transform: translateY(0.6rem) scale(0.92); }
}
@keyframes fade-in {
  from { opacity: 0; transform: translateX(-0.4rem); }
}
@keyframes shake {
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

.dots {
  display: inline-flex;
  gap: 3px;
  margin-right: 0.45rem;
  vertical-align: middle;
}
.dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  animation: bounce 1s ease-in-out infinite;
}
.dots i:nth-child(2) { animation-delay: 0.15s; }
.dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-4px); opacity: 1; }
}

.bubble {
  max-width: min(36rem, 92%);
  padding: 0.7rem 0.85rem;
  border-radius: 0.55rem;
  font-size: 0.92rem;
  line-height: 1.45;
  word-break: break-word;
}

.bubble.md :deep(p) { margin: 0.35em 0; }
.bubble.md :deep(p:first-child) { margin-top: 0; }
.bubble.md :deep(p:last-child) { margin-bottom: 0; }
.bubble.md :deep(a) { color: var(--accent); text-decoration: underline; word-break: break-all; }
.bubble.md :deep(a:hover) { opacity: 0.85; }
.bubble.md :deep(strong) { font-weight: 700; }
.bubble.md :deep(h1), .bubble.md :deep(h2), .bubble.md :deep(h3) { margin: 0.6em 0 0.3em; line-height: 1.25; }
.bubble.md :deep(h1) { font-size: 1.15em; }
.bubble.md :deep(h2) { font-size: 1.08em; }
.bubble.md :deep(h3) { font-size: 1em; }
.bubble.md :deep(code) { font-size: 0.85em; background: color-mix(in oklab, var(--border) 60%, transparent); padding: 0.15em 0.35em; border-radius: 0.25em; }
.bubble.md :deep(pre) { overflow-x: auto; padding: 0.6em; border-radius: 0.35em; background: color-mix(in oklab, var(--bg) 80%, var(--surface-2)); margin: 0.5em 0; }
.bubble.md :deep(pre code) { background: none; padding: 0; }
.bubble.md :deep(ul), .bubble.md :deep(ol) { margin: 0.35em 0; padding-left: 1.4em; }
.bubble.user.md :deep(a) { color: var(--on-accent); text-decoration-thickness: 1.5px; }

.bubble.user {
  align-self: flex-end;
  background: var(--accent);
  color: var(--on-accent);
}

.bubble.agent {
  align-self: flex-start;
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.bubble.error {
  align-self: stretch;
  background: color-mix(in oklab, var(--danger-base) 14%, var(--surface));
  color: var(--danger-ink);
  border: 1px solid color-mix(in oklab, var(--danger-base) 40%, var(--border));
}

.event {
  align-self: stretch;
  font-size: 0.72rem;
  color: var(--muted);
  padding: 0.25rem 0.4rem;
  opacity: 0.9;
}

.rate-wrap {
  align-self: stretch;
  display: flex;
}

.typing {
  font-size: 0.8rem;
  color: var(--muted);
  animation: pop-in 0.3s var(--ease-out) both;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

.btn.small {
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
}
</style>
