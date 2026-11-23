// next/server for the golden master tests: everything as usual, except
// after(), which queues the work so the test can wait for it to finish
// before it switches to the other driver (deterministic, unlike work that
// runs whenever the event loop gets to it).
export * from "next/server.js";

// A task starts only when the test drains the queue, which it does once the
// function under test has returned: as in production, where after() work
// runs after the response. (Starting it at once let a backfill rewrite rows
// while the function's own queries were still reading them, and which one
// won depended on the driver's speed.)
const queue: (Promise<unknown> | (() => unknown))[] = [];
export const afterStats = { calls: 0 };

export function after(task: Promise<unknown> | (() => unknown)): void {
  afterStats.calls++;
  queue.push(task);
}

/** Runs and waits for every queued after() task, in order, including ones queued meanwhile. */
export async function drainAfter(): Promise<void> {
  while (queue.length) {
    const task = queue.shift()!;
    try {
      await (typeof task === "function" ? task() : task);
    } catch {
      // As after() does: a failed task doesn't fail the request.
    }
  }
}
