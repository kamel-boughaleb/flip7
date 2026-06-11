/* Screen Wake Lock — keep the device awake while a game is on screen.

   The Screen Wake Lock API releases the sentinel automatically whenever the
   page becomes hidden (tab switch, screen off), so a simple acquire-once won't
   survive backgrounding. We track the *desired* state (`wanted`) and re-acquire
   on visibilitychange whenever the page returns to the foreground while a game
   is still active. No-ops gracefully where the API is unsupported (older iOS
   Safari, insecure contexts). */

let sentinel = null; // active WakeLockSentinel, or null
let wanted = false; // do we currently want the screen kept awake?

const supported = "wakeLock" in navigator;

async function acquire() {
  if (!supported || sentinel || document.hidden) return;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    // The OS can revoke the lock on its own (e.g. low battery). Clear our
    // handle so a later acquire() can request a fresh one.
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
  } catch {
    // Permission denied or transient failure — leave `wanted` set so the next
    // visibilitychange retries.
    sentinel = null;
  }
}

async function drop() {
  if (!sentinel) return;
  const s = sentinel;
  sentinel = null;
  try {
    await s.release();
  } catch {
    /* already released */
  }
}

// Re-acquire when the page returns to the foreground (the browser dropped the
// lock while hidden). Registered once.
if (supported) {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && wanted) acquire();
  });
}

/** Keep the screen awake (acquires the lock, re-arming across backgrounding). */
export function keepScreenAwake() {
  wanted = true;
  acquire();
}

/** Allow the screen to sleep again (releases the lock and stops re-arming). */
export function allowScreenSleep() {
  wanted = false;
  drop();
}
