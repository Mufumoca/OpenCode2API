import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createGateway, retryDelay } from '../../src/egress/gateway.js';

async function fixture(t, handler, overrides = {}) {
    const upstream = http.createServer(handler);
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const agents = [];
    const gateway = createGateway({ upstream: `http://127.0.0.1:${upstream.address().port}`,
        maxAttempts: 3, cooldownMs: 1000,
        nodes: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], ...overrides }, {
        agentFactory: () => { const agent = new http.Agent(); agents.push(agent); return agent; },
        logger: () => {} });
    gateway.listen(0, '127.0.0.1');
    await once(gateway, 'listening');
    t.after(() => {
        gateway.closeAllConnections(); gateway.close();
        upstream.closeAllConnections(); upstream.close(); agents.forEach(a => a.destroy());
    });
    return `http://127.0.0.1:${gateway.address().port}`;
}

test('429 switches nodes, preserves request body and honors cooldown', async t => {
    let calls = 0;
    const bodies = [];
    const url = await fixture(t, async (req, res) => {
        let body = ''; for await (const c of req) body += c;
        bodies.push(body);
        if (++calls === 1) { res.writeHead(429, { 'retry-after': '120' }); res.end('limited'); }
        else { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); }
    });
    const res = await fetch(url + '/inference/openai/v1/chat/completions', { method: 'POST', body: '{"test":1}' });
    assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(bodies, ['{"test":1}', '{"test":1}']);
    const health = await (await fetch(url + '/health')).json();
    assert.equal(health.current, 'b');
    assert.ok(health.nodes[0].cooldownUntil > Date.now() + 100000);
});

test('401 does not switch or retry', async t => {
    let calls = 0;
    const url = await fixture(t, (req, res) => { calls++; res.writeHead(401); res.end('invalid'); });
    const res = await fetch(url + '/inference/test');
    assert.equal(res.status, 401); assert.equal(await res.text(), 'invalid'); assert.equal(calls, 1);
});

test('5xx bounded to three distinct exits then pool cooldown', async t => {
    let calls = 0;
    const url = await fixture(t, (req, res) => { calls++; res.writeHead(503); res.end('busy'); }, { cooldownMs: 60000 });
    const res = await fetch(url + '/inference/test');
    assert.equal(res.status, 503); await res.text(); assert.equal(calls, 3);
    const second = await fetch(url + '/inference/test');
    assert.equal(second.status, 503); await second.text(); assert.equal(calls, 3);
});

test('network reset switches exit', async t => {
    let calls = 0;
    const url = await fixture(t, (req, res) => {
        if (++calls === 1) req.socket.destroy(); else res.end('OK');
    });
    const res = await fetch(url + '/inference/test');
    assert.equal(await res.text(), 'OK'); assert.equal(calls, 2);
});

test('broken SSE is never replayed after headers and content', async t => {
    let calls = 0;
    const url = await fixture(t, (req, res) => {
        calls++; res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: first\n\n'); setTimeout(() => res.destroy(), 50);
    });
    const res = await fetch(url + '/inference/test');
    await assert.rejects(res.text()); assert.equal(calls, 1);
});

test('arbitrary forward-proxy paths are rejected', async t => {
    const url = await fixture(t, () => assert.fail('must not reach upstream'));
    const res = await fetch(url + '/other'); assert.equal(res.status, 404); await res.text();
});

test('Retry-After numeric and HTTP date parsing', () => {
    assert.equal(retryDelay('120', 1000, 0), 120000);
    assert.equal(retryDelay('Thu, 01 Jan 1970 00:02:00 GMT', 1000, 0), 120000);
    assert.equal(retryDelay('invalid', 1000, 0), 1000);
});
