import { ref } from "vue";

export type Theme = "dark" | "light";
export type ThemePreference = Theme | "auto";

const KEY = "theme";
export const theme = ref<Theme>("dark");
export const themePreference = ref<ThemePreference>("auto");

let systemTheme: MediaQueryList | null = null;

function stored(): ThemePreference | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "auto" ? v : null;
  } catch {
    return null;
  }
}

function prefersLight() {
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

function resolve(pref: ThemePreference): Theme {
  return pref === "auto" ? (prefersLight() ? "light" : "dark") : pref;
}

function apply(pref: ThemePreference) {
  themePreference.value = pref;
  theme.value = resolve(pref);
  document.documentElement.dataset.theme = theme.value;
}

function onSystemChange() {
  if (themePreference.value === "auto") apply("auto");
}

export function initTheme() {
  apply(stored() ?? "auto");
  try {
    systemTheme = window.matchMedia("(prefers-color-scheme: light)");
    systemTheme.addEventListener?.("change", onSystemChange);
  } catch {
    // matchMedia unavailable; keep the resolved theme
  }
}

export function setThemePreference(pref: ThemePreference) {
  apply(pref);
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // storage blocked; theme still applies for this session
  }
}

const CYCLE: ThemePreference[] = ["auto", "light", "dark"];

export function cycleTheme() {
  const next = CYCLE[(CYCLE.indexOf(themePreference.value) + 1) % CYCLE.length]!;
  setThemePreference(next);
}
