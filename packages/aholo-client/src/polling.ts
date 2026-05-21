/**
 * Generic exponential-backoff polling helper.
 *
 * Aholo async jobs are minutes-long; the right poll cadence is "fast at first,
 * then slow". This avoids both wasting requests and laggy completion detection.
 */

export interface PollOptions {
  /** Initial interval in ms. Default 2000. */
  initialIntervalMs?: number;
  /** Maximum interval in ms. Default 15000. */
  maxIntervalMs?: number;
  /** Backoff multiplier per attempt. Default 1.4. */
  backoff?: number;
  /** Hard timeout in ms. Default 30 min. */
  timeoutMs?: number;
  /** Called on every successful poll — surface progress to the UI here. */
  onTick?: (attempt: number, value: unknown) => void;
  signal?: AbortSignal;
}

export interface PollResult<T> {
  done: boolean;
  value: T;
}

/**
 * Repeatedly call `fetcher` until `decide` reports done.
 *
 * @returns the value that `decide` marked as done
 * @throws on timeout, abort, or fetcher error
 */
export async function pollUntilDone<T>(
  fetcher: () => Promise<T>,
  decide: (value: T) => PollResult<T>,
  opts: PollOptions = {}
): Promise<T> {
  const initial = opts.initialIntervalMs ?? 2000;
  const max = opts.maxIntervalMs ?? 15000;
  const backoff = opts.backoff ?? 1.4;
  const timeout = opts.timeoutMs ?? 30 * 60 * 1000;
  const deadline = Date.now() + timeout;

  let interval = initial;
  let attempt = 0;

  while (true) {
    if (opts.signal?.aborted) {
      throw new DOMException('Polling aborted', 'AbortError');
    }
    if (Date.now() > deadline) {
      throw new Error(`Polling timed out after ${timeout}ms (attempt ${attempt})`);
    }

    attempt += 1;
    const value = await fetcher();
    opts.onTick?.(attempt, value);

    const result = decide(value);
    if (result.done) return result.value;

    await sleep(interval, opts.signal);
    interval = Math.min(Math.round(interval * backoff), max);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Sleep aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Sleep aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
