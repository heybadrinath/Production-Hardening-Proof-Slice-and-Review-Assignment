# PromptPilot: circuit-breaker proof slice

## 1. Risk addressed

PromptPilot depends on an external model to draft support replies. Repeated provider failures can waste capacity and delay every incoming ticket. This slice stops calling an unhealthy provider and returns the existing human-review fallback promptly.

## 2. Chosen control

A circuit breaker wraps the provider call in `src/circuitBreaker.js`. It starts CLOSED and tracks completed calls and failures. Once at least five calls have completed and the failure ratio reaches 0.5, it opens for 1,000 ms. These defaults are configurable. During that interval it rejects calls without invoking the provider. Afterward, exactly one HALF_OPEN probe is admitted; success resets the counting window and closes the breaker, while failure starts a new open interval. Late calls from an older window still update lifetime metrics but cannot change the new window.

## 3. How to run / test

Use Node.js 18 or newer. There are no packages to install and no API keys are required.

```sh
node --test
node scripts/demo.js
```

`npm test` and `npm run demo` are equivalent. The supplied tests are unchanged. Three additional tests exercise competing recovery probes, late in-flight failures, and the cooldown after a failed probe.

## 4. Evidence

All 11 tests pass, including the eight supplied tests. The deterministic demo makes five failed provider calls, serves the sixth request from the fallback without another provider call, then allows one successful probe after advancing the injected clock. See [test output](evidence/test-output.txt) and [demo output](evidence/demo-output.txt).

The demo ends with provider call count 6 and metrics `breaker_open_total=1`, `short_circuited_total=1`, `success_total=1`, and `failure_total=5`. Its transition sequence is OPEN → HALF_OPEN → CLOSED. This demonstrates failure isolation and recovery without relying on a live outage.

## 5. Observability note

Each opening increments `breaker_open_total`; every rejected request increments `short_circuited_total`. `success_total` and `failure_total` count actual provider outcomes across all windows. The `onStateChange` callback exposes each transition. The demo logs those transitions as `breaker_state_changed` JSON events, followed by a fallback event and a metrics snapshot. Production wiring should export the counters and attach a dependency identifier; it should not log ticket text, model prompts, credentials, or personal data.

## 6. Trade-off

Opening the breaker deliberately withholds model drafts, even if the provider recovers before the cooldown ends. It protects capacity at the cost of temporary reduced functionality. The counting window lasts until recovery rather than using a rolling time window, so a long healthy history can delay opening; this is acceptable for the assignment's specified control but needs workload-based tuning in production.

## 7. Remaining risk

The breaker reacts to completed failures. A provider call that hangs still needs its own timeout and cancellation policy. State is local to one service instance, so each replica can issue a recovery probe. Rate limits, bounded retries, output validation, and durable human-review delivery remain separate controls. The existing fallback text says a ticket is queued, but this starter has no real queue or persistence; the demo proves the response path, not delivery to an agent.

## 8. How this production control protects my Modules 1–3 design

For the provided PromptPilot scenario, Module 1's support-response contract can remain available when drafting fails: the service returns a defined fallback instead of spreading a dependency failure. Module 2's ticket records remain the source of truth; the breaker adds no model-written state and no schema change. Module 3's model stays a bounded drafting component with an explicit fallback, rather than becoming a requirement for every response. Human review, permissions, and output checks still own any consequential action; this slice does not claim to implement those separate parts.
