// next/server for the golden master tests: everything as usual, except
// after(), which queues the work so the test can wait for it to finish
// before it switches to the other driver (deterministic, unlike work that
// runs whenever the event loop gets to it).
export * from "next/server.js";

const queue: Promise<unknown>[] = [];
export const afterStats = { calls: 0 };

export function after(task: Promise<unknown> | (() => unknown)): void {
  afterStats.calls++;
  queue.push(Promise.resolve().then(() => (typeof task === "function" ? task() : task)).catch(() => {}));
}

/** Waits for every queued after() task, including ones queued meanwhile. */
export async function drainAfter(): Promise<void> {
  while (queue.length) await queue.shift();
}
