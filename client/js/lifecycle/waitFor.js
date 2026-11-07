/** Cancellable lifecycle wait; removes the abort listener on both settlement and cancellation. */
export function waitFor(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const clear = () => signal.removeEventListener('abort', cancel);
    const cancel = () => { clear(); reject(signal.reason); };
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise).then(value => { clear(); resolve(value); }, error => { clear(); reject(error); });
  });
}
