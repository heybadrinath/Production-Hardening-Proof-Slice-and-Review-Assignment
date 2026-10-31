'use strict';

class CircuitOpenError extends Error {
  constructor() {
    super('circuit is open');
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
  }
}

function createCircuitBreaker(options = {}) {
  const failureThreshold = options.failureThreshold ?? 0.5;
  const minimumRequests = options.minimumRequests ?? 5;
  const openMillis = options.openMillis ?? 1000;
  const now = options.now ?? Date.now;
  const onStateChange = options.onStateChange ?? function () {};

  if (!Number.isFinite(failureThreshold) || failureThreshold <= 0 || failureThreshold > 1) {
    throw new RangeError('failureThreshold must be greater than 0 and at most 1');
  }
  if (!Number.isInteger(minimumRequests) || minimumRequests < 1) {
    throw new RangeError('minimumRequests must be a positive integer');
  }
  if (!Number.isFinite(openMillis) || openMillis < 0) {
    throw new RangeError('openMillis must be a non-negative number');
  }
  if (typeof now !== 'function' || typeof onStateChange !== 'function') {
    throw new TypeError('now and onStateChange must be functions');
  }

  const metrics = {
    breaker_open_total: 0,
    short_circuited_total: 0,
    success_total: 0,
    failure_total: 0,
  };

  let state = 'CLOSED';
  let calls = 0;
  let failures = 0;
  let openedAt = 0;
  let generation = 0;

  function transition(nextState) {
    state = nextState;
    onStateChange(state);
  }

  function open() {
    openedAt = now();
    generation += 1;
    metrics.breaker_open_total += 1;
    transition('OPEN');
  }

  function rejectCall() {
    metrics.short_circuited_total += 1;
    throw new CircuitOpenError();
  }

  function recordOutcome(failed, callGeneration, probe) {
    // A call from before an opening must not affect a later recovery window.
    if (callGeneration !== generation) return;
    if (probe) {
      if (failed) {
        open();
      } else {
        calls = 0;
        failures = 0;
        generation += 1;
        transition('CLOSED');
      }
      return;
    }
    if (state !== 'CLOSED') return;
    calls += 1;
    if (failed) failures += 1;
    if (calls >= minimumRequests && failures / calls >= failureThreshold) open();
  }

  async function exec(fn) {
    if (state === 'HALF_OPEN') rejectCall();
    let probe = false;
    if (state === 'OPEN') {
      if (now() - openedAt < openMillis) rejectCall();
      // Set the state before awaiting the provider, admitting only one probe.
      probe = true;
      transition('HALF_OPEN');
    }
    const callGeneration = generation;
    let result;
    try {
      result = await fn();
    } catch (error) {
      metrics.failure_total += 1;
      recordOutcome(true, callGeneration, probe);
      throw error;
    }
    metrics.success_total += 1;
    recordOutcome(false, callGeneration, probe);
    return result;
  }

  return {
    exec,
    metrics,
    get state() {
      return state;
    },
  };
}

module.exports = { createCircuitBreaker, CircuitOpenError };
