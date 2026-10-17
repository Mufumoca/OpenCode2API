import fs from 'node:fs';
import path from 'node:path';

export function validatePoolConfig(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Pool config must be an object');
    const integer = (key, fallback, min, max) => {
        const value = raw[key] ?? fallback;
        if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid pool ${key}`);
        return value;
    };
    if (!Array.isArray(raw.nodes) || !raw.nodes.length) throw new Error('Pool requires proxy nodes');
    const names = new Set();
    const nodes = raw.nodes.map((node, index) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(`Invalid pool node at index ${index}`);
        const name = node.name || `exit-${index + 1}`;
        if (typeof name !== 'string' || !/^[\w .-]{1,64}$/.test(name) || names.has(name)) {
            throw new Error(`Invalid or duplicate pool node name at index ${index}`);
        }
        names.add(name);
        let url;
        try { url = new URL(node.proxy); } catch { throw new Error(`Invalid proxy URL at index ${index}`); }
        if (!['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(url.protocol) ||
            !url.hostname || (url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) {
            throw new Error(`Unsupported proxy URL at index ${index}`);
        }
        if (node.enabled !== undefined && typeof node.enabled !== 'boolean') throw new Error(`Invalid enabled at index ${index}`);
        return { name, proxy: url.href, enabled: node.enabled !== false };
    });
    if (!nodes.some(n => n.enabled)) throw new Error('Pool requires at least one enabled node');
    return {
        // Never accept an upstream override from a private node list.
        upstream: 'https://opencode.ai', nodes,
        listenPort: integer('listenPort', 18100, 1, 65535),
        maxAttempts: integer('maxAttempts', 3, 1, 10),
        cooldownMs: integer('cooldownMs', 60000, 1000, 86400000),
        firstByteTimeoutMs: integer('firstByteTimeoutMs', 60000, 1000, 300000),
        streamIdleTimeoutMs: integer('streamIdleTimeoutMs', 120000, 1000, 600000)
    };
}

export function loadPoolConfig(filename) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8')); }
    catch { throw new Error('Cannot read proxy pool config; check file permissions and JSON syntax'); }
    return validatePoolConfig(raw);
}

export function buildPoolBackendConfig(existing, port) {
    let config = {};
    if (existing) {
        try { config = JSON.parse(existing); }
        catch { throw new Error('Invalid OPENCODE_CONFIG_CONTENT JSON'); }
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid backend config');
    }
    const provider = config.provider || {};
    const opencode = provider.opencode || {};
    return JSON.stringify({ ...config, provider: { ...provider, opencode: { ...opencode,
        options: { ...opencode.options, baseURL: `http://127.0.0.1:${port}/inference/openai/v1` }
    } } });
}
