export class RequestTimeoutError extends Error {
  constructor() {
    super("The request exceeded its time limit.");
    this.name = "RequestTimeoutError";
  }
}

export function withRequestTimeout(operation, timeoutMs, callerSignal) {
  const controller = new AbortController();
  let timer;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onCallerAbort = () => {
    controller.abort();
    rejectAbort(callerSignal?.reason || new DOMException("The request was aborted.", "AbortError"));
  };

  if (callerSignal?.aborted) onCallerAbort();
  else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError());
    }, timeoutMs);
  });

  return Promise.race([
    Promise.resolve().then(() => operation(controller.signal)),
    aborted,
    timedOut,
  ]).finally(() => {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  });
}
