// Full-screen mode: a screen (the tracker, once a session is set up) asks the
// shell to hide its bar and tabs so it gets the whole screen; the screen then
// shows its own way out.
let on = false;
const listeners = new Set<() => void>();

export const focus = {
  get: () => on,
  set(next: boolean) {
    if (next === on) return;
    on = next;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};
