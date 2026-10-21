<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { GUIDE_PAGES, type GuidePage } from '../guide/story'

const emit = defineEmits<{ close: [] }>()

const STORAGE_KEY = 'web3agent-guide'

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLElement | null>(null)
const size = ref({ w: 800, h: 420 })
const pageIndex = ref(0)
const stepIndex = ref(0)
const pinned = ref<string | null>(null)
const playing = ref(false)
const modes = ref<Record<string, string>>({})

let timer = 0
let observer: ResizeObserver | null = null

const page = computed(() => GUIDE_PAGES[pageIndex.value] as GuidePage)

const mode = computed(() => {
  const control = page.value.control
  if (!control) return ''
  return modes.value[control.id] ?? control.default
})

const steps = computed(() => {
  const selected = mode.value
  return page.value.steps.filter((step) => !step.when || step.when === selected)
})

const step = computed(() => steps.value[Math.min(stepIndex.value, steps.value.length - 1)]!)

const lit = computed(() => new Set(step.value.on))

const pinnedNode = computed(() => page.value.nodes.find((node) => node.id === pinned.value) ?? null)

const progressLabel = computed(() => `${pageIndex.value + 1} / ${GUIDE_PAGES.length}`)

function center(id: string) {
  const node = page.value.nodes.find((item) => item.id === id)
  if (!node) return { x: 0, y: 0 }
  return {
    x: (node.x / 100) * size.value.w,
    y: (node.y / 100) * size.value.h,
  }
}

/** Stop the wire on the node box so the arrowhead is not hidden under the label. */
function meet(origin: { x: number; y: number }, toward: { x: number; y: number }) {
  const dx = toward.x - origin.x
  const dy = toward.y - origin.y
  const halfW = 66
  const halfH = 32
  const sx = dx === 0 ? Infinity : halfW / Math.abs(dx)
  const sy = dy === 0 ? Infinity : halfH / Math.abs(dy)
  const s = Math.min(sx, sy, 1)
  return { x: origin.x + dx * s, y: origin.y + dy * s }
}

const wires = computed(() =>
  page.value.edges.map((edge) => {
    const fromCenter = center(edge.from)
    const toCenter = center(edge.to)
    const from = meet(fromCenter, toCenter)
    const to = meet(toCenter, fromCenter)
    return { ...edge, from, to, active: lit.value.has(edge.id) }
  }),
)

function measure() {
  const el = canvas.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  size.value = { w: Math.max(rect.width, 1), h: Math.max(rect.height, 1) }
}

function clampStep() {
  if (stepIndex.value > steps.value.length - 1) stepIndex.value = steps.value.length - 1
  if (stepIndex.value < 0) stepIndex.value = 0
}

function goPage(index: number, keepPlaying = false) {
  if (!keepPlaying) playing.value = false
  pageIndex.value = Math.min(GUIDE_PAGES.length - 1, Math.max(0, index))
  stepIndex.value = 0
  pinned.value = null
}

function next() {
  if (stepIndex.value < steps.value.length - 1) {
    stepIndex.value += 1
    return
  }
  if (pageIndex.value < GUIDE_PAGES.length - 1) goPage(pageIndex.value + 1, true)
  else playing.value = false
}

function prev() {
  if (stepIndex.value > 0) {
    stepIndex.value -= 1
    return
  }
  if (pageIndex.value > 0) {
    goPage(pageIndex.value - 1)
    stepIndex.value = Math.max(0, stepsFor(GUIDE_PAGES[pageIndex.value]!).length - 1)
  }
}

function stepsFor(target: GuidePage) {
  const control = target.control
  const selected = control ? (modes.value[control.id] ?? control.default) : ''
  return target.steps.filter((item) => !item.when || item.when === selected)
}

function pickNode(id: string) {
  const node = page.value.nodes.find((item) => item.id === id)
  if (!node) return
  pinned.value = pinned.value === id ? null : id
  const wanted = page.value.steps[node.step]
  if (!wanted) return
  let index = steps.value.indexOf(wanted)
  if (index < 0) {
    index = steps.value.findIndex(
      (item) => item.on.length === wanted.on.length && item.on.every((token, i) => token === wanted.on[i]),
    )
  }
  if (index >= 0) stepIndex.value = index
  playing.value = false
}

function setMode(id: string) {
  const control = page.value.control
  if (!control) return
  modes.value = { ...modes.value, [control.id]: id }
  const nextSteps = page.value.steps.filter((item) => !item.when || item.when === id)
  const current = steps.value[stepIndex.value]
  const kept = current ? nextSteps.findIndex((item) => item.title === current.title) : -1
  stepIndex.value = kept >= 0 ? kept : Math.min(stepIndex.value, nextSteps.length - 1)
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    playing.value = false
    next()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    playing.value = false
    prev()
  } else if (event.key === ' ') {
    const tag = (event.target as HTMLElement | null)?.tagName
    if (tag === 'BUTTON') return
    event.preventDefault()
    playing.value = !playing.value
  } else if (event.key === 'Tab') {
    trap(event)
  }
}

function trap(event: KeyboardEvent) {
  const el = root.value
  if (!el) return
  const items = [...el.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')].filter(
    (item) => !item.hasAttribute('disabled') && item.tabIndex !== -1,
  )
  if (items.length === 0) return
  const first = items[0]!
  const last = items[items.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function persist() {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ page: pageIndex.value, step: stepIndex.value, modes: modes.value }),
    )
  } catch {
    /* private mode */
  }
}

function restore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as { page?: number; step?: number; modes?: Record<string, string> }
    if (saved.modes) modes.value = saved.modes
    if (typeof saved.page === 'number') pageIndex.value = Math.min(GUIDE_PAGES.length - 1, Math.max(0, saved.page))
    if (typeof saved.step === 'number') stepIndex.value = saved.step
    clampStep()
  } catch {
    /* ignore broken storage */
  }
}

watch([pageIndex, stepIndex, modes], persist, { deep: true })

watch(playing, (on) => {
  window.clearInterval(timer)
  if (!on) return
  timer = window.setInterval(next, 4200)
})

watch(pageIndex, () => {
  requestAnimationFrame(measure)
})

onMounted(() => {
  restore()
  measure()
  if (canvas.value) {
    observer = new ResizeObserver(measure)
    observer.observe(canvas.value)
  }
  root.value?.focus()
})

onBeforeUnmount(() => {
  window.clearInterval(timer)
  observer?.disconnect()
})
</script>

<template>
  <div
    ref="root"
    class="guide"
    role="dialog"
    aria-modal="true"
    aria-labelledby="guide-title"
    tabindex="-1"
    data-testid="how-it-works"
    @keydown="onKey"
  >
    <header class="top">
      <div>
        <p class="kicker">Guide</p>
        <h2 id="guide-title">How this app works</h2>
      </div>
      <p class="count mono">{{ progressLabel }}</p>
      <button type="button" class="btn ghost close" data-testid="close-guide" @click="emit('close')">
        Close
      </button>
    </header>

    <div class="body">
      <nav class="rail" aria-label="Guide pages">
        <ol>
          <li v-for="(item, index) in GUIDE_PAGES" :key="item.id">
            <button
              type="button"
              :aria-current="index === pageIndex ? 'page' : undefined"
              :data-testid="`guide-page-${item.id}`"
              @click="goPage(index)"
            >
              <span class="num mono">{{ String(index + 1).padStart(2, '0') }}</span>
              {{ item.nav }}
            </button>
          </li>
        </ol>
      </nav>

      <section class="stage" :aria-label="page.title">
        <div class="intro">
          <h3>{{ page.title }}</h3>
          <p>{{ page.lede }}</p>
        </div>

        <div class="canvas-scroll">
          <div ref="canvas" class="canvas" data-testid="guide-canvas">
            <svg class="wires" :viewBox="`0 0 ${size.w} ${size.h}`" aria-hidden="true">
              <defs>
                <marker id="guide-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M 0 1.2 L 8 5 L 0 8.8 z" class="arrow-idle" />
                </marker>
                <marker id="guide-arrow-on" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M 0 1.2 L 8 5 L 0 8.8 z" class="arrow-live" />
                </marker>
              </defs>
              <line
                v-for="wire in wires"
                :key="wire.id"
                :x1="wire.from.x"
                :y1="wire.from.y"
                :x2="wire.to.x"
                :y2="wire.to.y"
                :class="{ active: wire.active }"
                :marker-end="wire.active ? 'url(#guide-arrow-on)' : 'url(#guide-arrow)'"
              />
            </svg>

            <button
              v-for="node in page.nodes"
              :key="node.id"
              type="button"
              class="node"
              :class="{ on: lit.has(node.id), pinned: pinned === node.id }"
              :style="{ left: `${node.x}%`, top: `${node.y}%` }"
              :aria-pressed="pinned === node.id"
              @click="pickNode(node.id)"
            >
              <span class="node-kicker mono">{{ node.kicker }}</span>
              <span class="node-label">{{ node.label }}</span>
            </button>
          </div>
        </div>

        <div class="readout">
          <div class="flow" role="tablist" aria-label="Steps on this page">
            <button
              v-for="(item, index) in steps"
              :key="item.title"
              type="button"
              role="tab"
              class="pip"
              :class="{ on: index === stepIndex, done: index < stepIndex }"
              :aria-selected="index === stepIndex"
              @click="stepIndex = index; playing = false"
            >
              <span class="pip-index mono">{{ index + 1 }}</span>
              <span class="pip-title">{{ item.title }}</span>
            </button>
          </div>

          <div :key="`${page.id}-${stepIndex}-${mode}`" class="caption" aria-live="polite">
            <h4>{{ step.title }}</h4>
            <p>{{ step.body }}</p>
            <p v-if="pinnedNode" class="pin">
              <span class="mono">{{ pinnedNode.label }}</span>
              {{ pinnedNode.detail }}
            </p>
          </div>

          <div class="controls">
            <div v-if="page.control" class="modes" role="group" :aria-label="page.control.label">
              <span class="mode-label">{{ page.control.label }}</span>
              <button
                v-for="option in page.control.options"
                :key="option.id"
                type="button"
                class="btn ghost"
                :class="{ chosen: mode === option.id }"
                :aria-pressed="mode === option.id"
                @click="setMode(option.id)"
              >
                {{ option.label }}
              </button>
            </div>

            <div class="transport">
              <button type="button" class="btn ghost" data-testid="guide-prev" @click="playing = false; prev()">
                Back
              </button>
              <button
                type="button"
                class="btn ghost"
                data-testid="guide-play"
                :aria-pressed="playing"
                @click="playing = !playing"
              >
                {{ playing ? 'Pause' : 'Play' }}
              </button>
              <button type="button" class="btn primary" data-testid="guide-next" @click="playing = false; next()">
                Next
              </button>
              <span class="step-count mono">{{ stepIndex + 1 }} / {{ steps.length }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.guide {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--ink);
  outline: none;
}

.top {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 0.85rem 1.25rem;
  border-bottom: 1px solid var(--border);
}

.kicker {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.top h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.count {
  margin: 0 0 0 auto;
  color: var(--muted);
  font-size: 0.82rem;
}

.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 15.5rem minmax(0, 1fr);
}

.rail {
  border-right: 1px solid var(--border);
  overflow: auto;
  padding: 0.75rem 0.6rem 1.5rem;
}

.rail ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.rail button {
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  text-align: left;
  font: inherit;
  font-size: 0.92rem;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 0.35rem;
  padding: 0.45rem 0.55rem;
  cursor: pointer;
}

.rail button:hover {
  color: var(--ink);
  background: var(--surface);
}

.rail button[aria-current='page'] {
  color: var(--ink);
  background: var(--surface-2);
}

.num {
  font-size: 0.72rem;
  color: var(--accent);
  flex-shrink: 0;
}

.stage {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  padding: 1.1rem 1.4rem 1.4rem;
  gap: 0.9rem;
}

.intro,
.canvas-scroll,
.readout {
  flex-shrink: 0;
}

.intro h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.55rem;
  font-weight: 600;
  letter-spacing: -0.03em;
}

.intro p {
  margin: 0.35rem 0 0;
  max-width: 42rem;
  color: var(--muted);
  font-size: 1.02rem;
}

.canvas-scroll {
  overflow: auto;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.canvas {
  position: relative;
  min-width: 46rem;
  height: 26rem;
  background-image: radial-gradient(circle, color-mix(in oklab, var(--border) 80%, transparent) 1px, transparent 1px);
  background-size: 22px 22px;
  background-position: -1px -1px;
}

.wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.wires line {
  stroke: var(--border);
  stroke-width: 1.5;
  fill: none;
}

.wires line.active {
  stroke: var(--accent);
  stroke-dasharray: 5 7;
  animation: march 0.9s linear infinite;
}

.arrow-idle {
  fill: var(--muted);
}

.arrow-live {
  fill: var(--accent);
}

.node {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 7.6rem;
  min-height: 3.35rem;
  padding: 0.4rem 0.55rem 0.45rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.12rem;
  text-align: left;
  font: inherit;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  cursor: pointer;
  z-index: 1;
}

.node:hover,
.node:focus-visible {
  border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
}

.node.on {
  border-color: var(--accent);
  background: color-mix(in oklab, var(--accent) 10%, var(--surface));
}

.node.pinned {
  outline: 1px solid var(--accent);
  outline-offset: 2px;
}

.node-kicker {
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.node.on .node-kicker {
  color: var(--accent);
}

.node-label {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 0.86rem;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.readout {
  display: grid;
  grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr);
  gap: 1.25rem 1.5rem;
  align-items: start;
}

.flow {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.pip {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  text-align: left;
  font: inherit;
  font-size: 0.84rem;
  color: var(--muted);
  background: transparent;
  border: 0;
  padding: 0.28rem 0.2rem;
  cursor: pointer;
}

.pip.on {
  color: var(--ink);
}

.pip.on .pip-index {
  color: var(--accent);
}

.pip.done {
  color: color-mix(in oklab, var(--ink) 70%, var(--muted));
}

.pip-index {
  font-size: 0.68rem;
  flex-shrink: 0;
}

.pip-title {
  line-height: 1.3;
}

.caption h4 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.12rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.caption p {
  margin: 0.4rem 0 0;
  max-width: 40rem;
  line-height: 1.5;
}

.pin {
  color: var(--muted);
  font-size: 0.92rem;
}

.pin .mono {
  color: var(--accent);
  margin-right: 0.4rem;
}

.controls {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  align-items: center;
}

.modes,
.transport {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.mode-label,
.step-count {
  color: var(--muted);
  font-size: 0.8rem;
}

.modes .btn.chosen {
  border-color: var(--accent);
  color: var(--accent);
}

.caption {
  animation: rise 0.35s ease;
}

@keyframes march {
  to {
    stroke-dashoffset: -24;
  }
}

@keyframes rise {
  from {
    transform: translateY(4px);
  }
  to {
    transform: none;
  }
}

@media (max-width: 860px) {
  .body {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .rail {
    border-right: 0;
    border-bottom: 1px solid var(--border);
    padding: 0.4rem 0.6rem;
  }

  .rail ol {
    flex-direction: row;
    gap: 0.25rem;
  }

  .rail li {
    flex: 0 0 auto;
  }

  .rail button {
    width: auto;
    white-space: nowrap;
  }

  .canvas {
    height: 20rem;
  }

  .readout {
    grid-template-columns: 1fr;
  }

  .flow {
    flex-direction: row;
    overflow: auto;
  }

  .pip {
    flex: 0 0 auto;
    max-width: 14rem;
    padding: 0.35rem 0.55rem;
  }
}
</style>
