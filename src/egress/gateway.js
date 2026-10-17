import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';

import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
export function createProxyAgent(node) {
    return node.proxy.startsWith('socks')
        ? new SocksProxyAgent(node.proxy) : new HttpsProxyAgent(node.proxy);
}

const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate',
    'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);

function cleanHeaders(headers) {
    const removed = new Set([...HOP_HEADERS,
        ...String(headers.connection || '').toLowerCase().split(',').map(s => s.trim())]);
    return Object.fromEntries(Object.entries(headers).filter(([k]) => !removed.has(k.toLowerCase())));
}

export function retryDelay(header, fallback, now = Date.now()) {
    if (!header) return fallback;
    const seconds = Number(header);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
    return Number.isFinite(delay) ? Math.max(fallback, delay) : fallback;
}

export function createGateway(config, { agentFactory = createProxyAgent,
    logger = console.log } = {}) {
    const nodes = config.nodes.filter(n => n.enabled !== false).map(n => ({ ...n, agent: agentFactory(n), cooldownUntil: 0,
        successes: 0, failures: 0, consecutiveFailures: 0, active: 0 }));
    if (!nodes.length) throw new Error('At least one proxy node is required');
    let cursor = 0;
    let lastSelected = null;
    const failureThreshold = config.failureThreshold || 2;
    const maxAttempts = config.maxAttempts || 3;
    const cooldown = config.cooldownMs || 60000;
    const upstream = new URL(config.upstream);
    const transport = upstream.protocol === 'https:' ? https : http;
    const retryable = status => status === 429 || status === 408 || status >= 500;

    function select(tried, reserve = true) {
        for (let i = 0; i < nodes.length; i++) {
            const index = (cursor + i) % nodes.length;
            const node = nodes[index];
            if (!tried.has(node) && node.cooldownUntil <= Date.now()) {
                if (reserve) {
                    cursor = (index + 1) % nodes.length;
                    lastSelected = node.name;
                }
                return node;
            }
        }
        return null;
    }

    function fail(node, status, retryAfter) {
        node.failures++;
        node.consecutiveFailures++;
        if (status === 429 || node.consecutiveFailures >= failureThreshold) {
            node.cooldownUntil = Date.now() + retryDelay(retryAfter, cooldown);
        }
        logger(JSON.stringify({ event: 'egress_failure', node: node.name,
            status, consecutiveFailures: node.consecutiveFailures, cooldownUntil: node.cooldownUntil ? new Date(node.cooldownUntil).toISOString() : null }));
    }

    function sendError(res, status, message) {
        if (!res.destroyed && !res.headersSent) {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message, type: 'egress_error' } }));
        }
    }

    const server = http.createServer(async (req, res) => {
        if (req.url === '/health' && req.method === 'GET') {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ status: 'ok', strategy: 'round-robin', current: lastSelected, next: nodes[cursor].name,
                nodes: nodes.map(({ name, cooldownUntil, successes, failures, consecutiveFailures, active }) =>
                    ({ name, cooldownUntil, successes, failures, consecutiveFailures, active })) }));
            return;
        }
        // This is a fixed-host reverse proxy, never an arbitrary URL/CONNECT proxy.
        if (!req.url?.startsWith('/inference/') || !['GET', 'POST'].includes(req.method)) {
            sendError(res, 404, 'Unknown inference route');
            return;
        }
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableFinished) controller.abort(); });
        const tried = new Set();
        try {
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 32 * 1024 * 1024) {
                    sendError(res, 413, 'Request body exceeds 32 MiB');
                    return;
                }
                chunks.push(chunk);
            }
            const body = Buffer.concat(chunks);
            const target = new URL(upstream);
            target.pathname = req.url.split('?')[0];
            target.search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
            const headers = { ...cleanHeaders(req.headers), 'content-length': String(body.length) };

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                if (controller.signal.aborted) return;
                const node = select(tried);
                if (!node) {
                    const wait = Math.max(1, Math.ceil((Math.min(...nodes.map(n => n.cooldownUntil)) - Date.now()) / 1000));
                    res.setHeader('retry-after', String(wait));
                    sendError(res, 503, 'No eligible proxy exits; wait for cooldown');
                    return;
                }
                tried.add(node);
                node.active++;
                let response;
                try {
                    response = await new Promise((resolve, reject) => {
                        const request = transport.request(target, { method: req.method, headers,
                            agent: node.agent, signal: controller.signal }, incoming => {
                            clearTimeout(timer);
                            resolve(incoming);
                        });
                        // Covers proxy CONNECT/TLS and first response headers, not only socket idle.
                        const timer = setTimeout(() => request.destroy(new Error('First byte timeout')),
                            config.firstByteTimeoutMs || 60000);
                        request.on('error', error => { clearTimeout(timer); reject(error); });
                        request.end(body);
                    });
                } catch (error) {
                    node.active--;
                    if (controller.signal.aborted) return;
                    fail(node, 'network');
                    if (attempt === maxAttempts) {
                        sendError(res, 502, 'Proxy exits failed before receiving an upstream response');
                        return;
                    }
                    continue;
                }

                const status = response.statusCode || 502;
                if (retryable(status)) {
                    fail(node, status, response.headers['retry-after']);
                    if (attempt < maxAttempts && select(tried, false)) {
                        node.active--;
                        response.destroy();
                        logger(JSON.stringify({ event: 'egress_retry', node: node.name, status, attempt }));
                        await new Promise(resolve => setTimeout(resolve, Math.min(attempt * 500, 2000)));
                        continue;
                    }
                }
                logger(JSON.stringify({ event: 'egress_response', node: node.name, status, attempt }));
                res.writeHead(status, cleanHeaders(response.headers));
                response.setTimeout(config.streamIdleTimeoutMs || 120000, () =>
                    response.destroy(new Error('Upstream stream idle timeout')));
                try {
                    // Once headers/body reach OpenCode, replay is forbidden, including broken SSE.
                    await pipeline(response, res, { signal: controller.signal });
                    if (status < 400) {
                        node.successes++;
                        node.consecutiveFailures = 0;
                        node.cooldownUntil = 0;
                    }
                } catch {
                    if (!controller.signal.aborted && !retryable(status)) fail(node, 'stream');
                    if (!res.destroyed) res.destroy();
                } finally {
                    node.active--;
                }
                return;
            }
        } catch {
            sendError(res, 502, 'Egress request failed');
        }
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
    server.on('close', () => nodes.forEach(n => n.agent?.destroy()));
    return server;
}
