/** True when a keydown should send the message (Enter without Shift, outside IME composition). */
export function isSubmitKey(e: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.isComposing;
}
