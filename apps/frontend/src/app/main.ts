import { Buffer } from "buffer";
import process from "process";
import { createApp } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import App from "./App.vue";
import "./style.css";
import { initTheme } from "@/shared/lib";

initTheme();

/**
 * Keep the app shell exactly as tall as the visible viewport.
 *
 * `100dvh` is usually fine, but it can lag behind the real visible height
 * (mobile toolbars/keyboard, embedded browsers), leaving a strip of empty
 * background below the chat composer until the next reload. visualViewport is
 * the authoritative "what the user can actually see" size, so mirror it into
 * --app-height and use that for the shell height.
 */
function syncAppHeight() {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

syncAppHeight();
window.addEventListener("resize", syncAppHeight);
window.visualViewport?.addEventListener("resize", syncAppHeight);
window.visualViewport?.addEventListener("scroll", syncAppHeight);

window.Buffer = Buffer;
window.process = process;

const queryClient = new QueryClient();

createApp(App).use(VueQueryPlugin, { queryClient }).mount("#app");
