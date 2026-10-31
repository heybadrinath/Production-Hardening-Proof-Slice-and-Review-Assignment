'use strict';

const assert = require('node:assert/strict');
const { createReplyService } = require('../src/replyService');

let clock = 0;
let providerCalls = 0;
let available = false;
const service = createReplyService(async () => {
  providerCalls += 1;
  if (!available) throw new Error('provider unavailable');
  return 'A draft for human review.';
}, {
  minimumRequests: 5,
  failureThreshold: 0.5,
  openMillis: 1000,
  now: () => clock,
  onStateChange: state => console.log(JSON.stringify({ event: 'breaker_state_changed', state })),
});

async function main() {
  for (let i = 0; i < 5; i += 1) await service.draftReply({ id: i });
  const fallback = await service.draftReply({ id: 5 });
  assert.equal(fallback.reason, 'circuit_open');
  assert.equal(providerCalls, 5);
  console.log(JSON.stringify({ event: 'safe_fallback', ...fallback, providerCalls }));
  available = true;
  clock = 1000;
  const recovered = await service.draftReply({ id: 6 });
  assert.equal(recovered.source, 'model');
  console.log(JSON.stringify({ event: 'recovered', state: service.breaker.state, providerCalls }));
  console.log(JSON.stringify({ event: 'breaker_metrics', ...service.breaker.metrics }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
