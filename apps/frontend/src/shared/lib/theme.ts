import { ref } from 'vue'

export type Theme = 'dark' | 'light'

const KEY = 'theme'
export const theme = ref<Theme>('dark')

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function apply(t: Theme) {
  theme.value = t
  document.documentElement.dataset.theme = t
}

export function initTheme() {
  apply(stored() ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
}

export function toggleTheme() {
  const next: Theme = theme.value === 'dark' ? 'light' : 'dark'
  apply(next)
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // storage blocked; theme still applies for this session
  }
}
