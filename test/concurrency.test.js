const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCircuitBreaker, CircuitOpenError } = require('../src/circuitBreaker');

test('admits only one recovery probe while concurrent requests fail fast', async () => {
  let clock = 0;
  const cb = createCircuitBreaker({ minimumRequests: 1, openMillis: 100, now: () => clock });
  await assert.rejects(cb.exec(() => Promise.reject(new Error('down'))));
  clock = 100;
  let release;
  let providerCalls = 0;
  const probe = cb.exec(() => {
    providerCalls += 1;
    return new Promise(resolve => { release = resolve; });
  });
  assert.equal(cb.state, 'HALF_OPEN');
  await assert.rejects(cb.exec(() => { providerCalls += 1; }), CircuitOpenError);
  assert.equal(providerCalls, 1);
  release('recovered');
  assert.equal(await probe, 'recovered');
  assert.equal(cb.state, 'CLOSED');
});

test('late results from before an opening cannot contaminate the recovered window', async () => {
  let clock = 0;
  const cb = createCircuitBreaker({ minimumRequests: 2, openMillis: 100, now: () => clock });
  let failOldCall;
  const oldCall = cb.exec(() => new Promise((resolve, reject) => { failOldCall = reject; }));
  await assert.rejects(cb.exec(() => Promise.reject(new Error('down'))));
  await assert.rejects(cb.exec(() => Promise.reject(new Error('down'))));
  clock = 100;
  await cb.exec(() => 'recovered');
  failOldCall(new Error('late failure'));
  await assert.rejects(oldCall, /late failure/);
  await assert.rejects(cb.exec(() => { throw new Error('new failure'); }));
  assert.equal(cb.state, 'CLOSED');
  assert.deepEqual(cb.metrics, {
    breaker_open_total: 1,
    short_circuited_total: 0,
    success_total: 1,
    failure_total: 4,
  });
});

test('a failed probe starts a fresh full cooldown', async () => {
  let clock = 0;
  const cb = createCircuitBreaker({ minimumRequests: 1, openMillis: 100, now: () => clock });
  const fail = () => { throw new Error('down'); };
  await assert.rejects(cb.exec(fail));
  clock = 100;
  await assert.rejects(cb.exec(fail));
  clock = 199;
  await assert.rejects(cb.exec(() => 'too soon'), CircuitOpenError);
  clock = 200;
  assert.equal(await cb.exec(() => 'ready'), 'ready');
  assert.equal(cb.metrics.breaker_open_total, 2);
});
