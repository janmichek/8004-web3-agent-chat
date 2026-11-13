import { Buffer } from "buffer";
import process from "process";
import { createApp } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import App from "./App.vue";
import "./style.css";
import { initTheme } from "@/shared/lib";

initTheme();

/**
 * Keep the app shell exactly on top of the visible viewport.
 *
 * `100dvh` is usually fine, but it can lag behind the real visible area
 * (mobile toolbars/keyboard, embedded browsers), leaving a strip of empty
 * background below the chat composer until the next reload. visualViewport is
 * the authoritative "what the user can actually see" rect, so mirror both its
 * height and its offset into CSS: a panned visual viewport (offsetTop > 0)
 * must shift the shell down, otherwise the shell ends above the visible bottom.
 */
function syncAppHeight() {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const offsetTop = viewport?.offsetTop ?? 0;
  const style = document.documentElement.style;
  style.setProperty("--app-height", `${height}px`);
  style.setProperty("--app-offset", `${offsetTop}px`);
}

syncAppHeight();
window.addEventListener("resize", syncAppHeight);
window.visualViewport?.addEventListener("resize", syncAppHeight);
window.visualViewport?.addEventListener("scroll", syncAppHeight);

window.Buffer = Buffer;
window.process = process;

const queryClient = new QueryClient();

createApp(App).use(VueQueryPlugin, { queryClient }).mount("#app");
