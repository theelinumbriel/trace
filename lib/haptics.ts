/**
 * Haptic feedback where browser support exists. navigator.vibrate ships on
 * Android Chrome (user-gesture-gated); iOS Safari has never implemented it
 * and Apple patched the checkbox-switch workaround in iOS 26.5 — on iOS the
 * scanner's freeze-frame + white flash carries the confirmation instead.
 * Nothing is ever gated on a haptic firing.
 */
export const haptics = {
  tick(): void {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(35);
    }
  },
  success(): void {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([20, 40, 20]);
    }
  },
};
