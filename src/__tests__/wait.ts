// Deterministic waits for tests, in place of fixed sleeps. A fixed sleep is
// both slow (it always waits the full time) and flaky (on a loaded machine the
// work it waits for can take longer). These wait exactly as long as the
// condition takes, and fail loudly with a timeout when it never comes.

/** Poll `pred` until it is true; reject after `timeoutMs`. */
export async function waitFor(pred: () => boolean, timeoutMs = 2000, what = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`waitFor: ${what} not reached within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 1));
  }
}

interface Listens {
  on(method: string, fn: (params: unknown) => void): void;
}

let barrierSeq = 0;

/**
 * Wait until every notification routed BEFORE this call has been delivered.
 *
 * The SDK delivers notifications through one ordered pump, so a sentinel
 * routed now is handled only after everything already queued. Once it
 * arrives, a test can assert that an event was NOT delivered — which no
 * amount of polling for the positive cases can prove when the negatives sit
 * later in the queue.
 *
 * `send` routes one notification with the given method (each test file has
 * its own router over the private `routeMessage`).
 */
export async function notificationBarrier(
  plugin: Listens,
  send: (method: string) => void,
  timeoutMs = 2000,
): Promise<void> {
  const method = `test.barrier.n${++barrierSeq}`;
  let reached = false;
  plugin.on(method, () => {
    reached = true;
  });
  send(method);
  await waitFor(() => reached, timeoutMs, `notification barrier ${method}`);
}
