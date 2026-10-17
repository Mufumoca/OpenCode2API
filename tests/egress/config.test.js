import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePoolConfig, buildPoolBackendConfig } from '../../src/egress/config.js';
import { createProxyAgent } from '../../src/egress/gateway.js';

const valid = () => ({ nodes: [{ name: 'exit-a', proxy: 'http://127.0.0.1:18110' }] });

test('defaults and fixed upstream cannot be overridden', () => {
    const config = validatePoolConfig({ ...valid(), upstream: 'https://example.invalid' });
    assert.equal(config.upstream, 'https://opencode.ai');
    assert.equal(config.maxAttempts, 3);
});

test('rejects invalid configs without echoing credentials', () => {
    for (const raw of [null, {}, { nodes: [] }, { ...valid(), maxAttempts: 0 },
        { ...valid(), listenPort: 70000 }, { nodes: [{ proxy: 'file:///secret' }] },
        { nodes: [{ proxy: 'http://user:secret@' }] },
        { nodes: [{ proxy: 'http://localhost/path' }] },
        { nodes: [{ proxy: 'http://localhost', enabled: false }] },
        { nodes: [valid().nodes[0], valid().nodes[0]] }]) {
        assert.throws(() => validatePoolConfig(raw), error => !error.message.includes('secret'));
    }
});

test('accepts HTTP, HTTPS and SOCKS agents', () => {
    for (const protocol of ['http', 'https', 'socks4', 'socks4a', 'socks5', 'socks5h']) {
        const config = validatePoolConfig({ nodes: [{ proxy: `${protocol}://127.0.0.1:1080` }] });
        const agent = createProxyAgent(config.nodes[0]);
        assert.equal(agent.constructor.name, protocol.startsWith('socks') ? 'SocksProxyAgent' : 'HttpsProxyAgent');
        agent.destroy();
    }
});

test('backend override preserves plugins, other providers and model settings', () => {
    const existing = { plugin: ['custom-plugin'], provider: { other: { options: { x: 1 } },
        opencode: { models: { example: {} }, options: { apiKey: 'placeholder' } } } };
    const result = JSON.parse(buildPoolBackendConfig(JSON.stringify(existing), 18100));
    assert.deepEqual(result.plugin, existing.plugin);
    assert.deepEqual(result.provider.other, existing.provider.other);
    assert.deepEqual(result.provider.opencode.models, existing.provider.opencode.models);
    assert.equal(result.provider.opencode.options.apiKey, 'placeholder');
    assert.equal(result.provider.opencode.options.baseURL, 'http://127.0.0.1:18100/inference/openai/v1');
    assert.throws(() => buildPoolBackendConfig('not JSON', 18100));
});
