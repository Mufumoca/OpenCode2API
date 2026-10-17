# OpenCode2API

<p align="center">
  <img src="https://img.shields.io/badge/version-2.5.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/Node.js-18+-orange" alt="Node">
</p>

English | [简体中文](./README.md)

Turns a local [OpenCode](https://opencode.ai) runtime into an OpenAI-compatible API gateway, for compatible clients and New API.

This fork of [TiaraBasori/opencode2api](https://github.com/TiaraBasori/opencode2api) adds an **isolated outbound proxy pool with automatic failover**. It does not change system proxy settings or other services.

> Model availability and rate limits are controlled by the upstream. Free does not mean unlimited; changing exits may not resolve account- or model-level limits.

## ✨ Features

- **OpenAI compatible** — `/v1/models`, `/v1/chat/completions`, `/v1/responses` with full SSE streaming
- **Reasoning control** — supports `reasoning_effort` and `reasoning: {"effort": "high"}`
- **Session chaining** — Responses API supports `previous_response_id`, 30-minute TTL, upstream sessions cleaned up on expiry
- **External tool bridge** — client-supplied `tools` return standard `tool_calls` / `function_call` from the proxy, never touching OpenCode built-in tools
- **Built-in tool allowlist** — requests without `tools` only allow built-ins listed in `OPENCODE_INTERNAL_ALLOWED_TOOLS`
- **Observability** — `/health/details` structured diagnostics, `/metrics` Prometheus metrics
- **Web Panel** — optional built-in dashboard at `/panel` (read-only status/models/diagnostics), off by default
- **Isolated proxy pool** — HTTP/HTTPS/SOCKS exits, bounded retries on 429/408/5xx and network failures, cooldowns, no replay of started streams
- **Docker deployment** — one command starts the stack and the OpenCode backend

## 🚀 Quick Start

### Docker (recommended)

```bash
git clone https://github.com/Mufumoca/OpenCode2API.git
cd OpenCode2API
cp .env.example .env        # Edit .env; API_KEY and OPENCODE_SERVER_PASSWORD are required
docker compose up -d --build
curl http://127.0.0.1:10000/health
```

> Use `--build` to build this fork rather than using an upstream image without these additions.

> The default Compose file does not mount the host project directory, since that would shadow the `node_modules` baked into the image. Use a separate dev Compose override for source hot-reload.

### Node.js (local development)

```bash
# Install the OpenCode CLI
npm install -g opencode-ai@1.19.0
# or curl -fsSL https://opencode.ai/install | bash

git clone https://github.com/Mufumoca/OpenCode2API.git
cd OpenCode2API
npm install
cp config.json.example config.json
npm start
```

## 💡 Usage Examples

### Chat Completions

```bash
curl -X POST http://127.0.0.1:10000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/big-pickle",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

### Responses API (streaming + reasoning)

```bash
curl -N -X POST http://127.0.0.1:10000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt5-nano",
    "input": "Say hi in one sentence.",
    "reasoning": {"effort": "high"},
    "stream": true
  }'
```

### External tools

```bash
curl -X POST http://127.0.0.1:10000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/big-pickle",
    "messages": [{"role": "user", "content": "Fetch https://example.com and tell me the title"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "web_fetch",
        "description": "Fetch a URL and return its content summary",
        "parameters": {
          "type": "object",
          "properties": {"url": {"type": "string"}},
          "required": ["url"]
        }
      }
    }]
  }'
```

When the model calls tools, non-streaming responses return `message.tool_calls` and streaming responses return `delta.tool_calls`.

### Anthropic Messages API (/v1/messages)

An endpoint for Claude SDK / Anthropic clients. Authentication uses the `x-api-key` header (`Authorization: Bearer` also works), and tool calls come back as `tool_use` content blocks.

```bash
curl -X POST http://127.0.0.1:10000/v1/messages \
  -H "x-api-key: ***" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/big-pickle",
    "max_tokens": 1024,
    "system": "You are concise.",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

Tool round-trip (send results back as `tool_result` blocks):

```bash
curl -X POST http://127.0.0.1:10000/v1/messages \
  -H "x-api-key: ***" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/big-pickle",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Fetch the title of https://example.com"}],
    "tools": [{
      "name": "web_fetch",
      "description": "Fetch a URL and return its content summary",
      "input_schema": {
        "type": "object",
        "properties": {"url": {"type": "string"}},
        "required": ["url"]
      }
    }]
  }'
```

The response contains a `{"type":"tool_use","id":"…","name":"web_fetch","input":{…}}` content block (`stop_reason: "tool_use"`); send the result back as a `{"type":"tool_result","tool_use_id":"…","content":"…"}` user block to continue the conversation. With `stream: true` the proxy emits the Anthropic SSE sequence `message_start` → `content_block_*` → `message_delta` → `message_stop`.

## ⚙️ Configuration

| Environment variable | Default | Description |
|:--------|:-------|:-----|
| `API_KEY` | (empty) | Proxy Bearer auth key |
| `OPENCODE_API_KEYS` | (empty) | Multi-user API key list, comma-separated `name:key` (see [Configuration](./docs/en/configuration.md)) |
| `OPENCODE_SERVER_PASSWORD` | (empty) | OpenCode backend password |
| `OPENCODE_PROXY_PORT` / `PORT` | `10000` | Proxy port |
| `OPENCODE_SERVER_PORT` | `10001` | Backend port (applies when `OPENCODE_SERVER_URL` is not set) |
| `OPENCODE_SERVER_URL` | `http://127.0.0.1:10001` | Backend URL |
| `OPENCODE_DISABLE_TOOLS` | `true` | Disable OpenCode built-in tools |
| `OPENCODE_INTERNAL_ALLOWED_TOOLS` | (empty) | Built-ins allowed when a request has no `tools`, comma-separated |
| `OPENCODE_PROXY_OMIT_SYSTEM_PROMPT` | `false` | Ignore the incoming system prompt |
| `OPENCODE_PROXY_AUTO_CLEANUP_CONVERSATIONS` | `false` | Auto-clean session storage |
| `OPENCODE_USE_ISOLATED_HOME` | `false` | Use an isolated OpenCode config directory |
| `OPENCODE_WEB_PANEL_ENABLED` | `false` | Serve the built-in Web Panel at `/panel` |
| `OPENCODE_PROXY_POOL_CONFIG` | (empty, disabled) | Path to a private proxy pool JSON file |
| `OPENCODE_PROXY_DEBUG` | `false` | Debug logging |

> 📄 Full reference: [Configuration](./docs/en/configuration.md)

Recommended production settings:

```env
API_KEY=your-secret-key
OPENCODE_SERVER_PASSWORD=your-password
OPENCODE_DISABLE_TOOLS=true
OPENCODE_INTERNAL_ALLOWED_TOOLS=web_fetch
OPENCODE_PROXY_OMIT_SYSTEM_PROMPT=true
OPENCODE_PROXY_AUTO_CLEANUP_CONVERSATIONS=true
```

## Outbound Proxy Pool

Disabled by default. Provide your own HTTP/HTTPS/SOCKS proxies, then run:

```bash
cp proxy-pool.example.json proxy-pool.json
# Edit proxy-pool.json with your own proxy endpoints
chmod 600 proxy-pool.json
OPENCODE_PROXY_POOL_CONFIG=./proxy-pool.json npm start
```

The example uses placeholder loopback proxy endpoints, not working nodes.
Alternatively set `PROXY_POOL_CONFIG` in config.json. Requires
`MANAGE_BACKEND=true` and a newly started backend managed by this project.
Only the child OpenCode process's `opencode` provider is redirected.

- Rotate through eligible exits on every new request, wrapping at the end; failures retry on the next exit.
- Default: three distinct exits per request; two consecutive failures trigger a 60-second cooldown (`failureThreshold`), while 429 cools down immediately and honors Retry-After. Success resets the streak; expired nodes rejoin rotation.
- Do not retry request/authentication errors such as 400/401/403, or replay responses after forwarding headers.
- Return 503 with Retry-After when no exit is eligible; never fall back to direct access.
- Concurrent connections retain their own fixed proxy agents. OpenCode/API-layer retries may add further attempts.
- Lost responses may lead to duplicate inference/billing on retry; switching IPs does not guarantee recovery from limits.

Mihomo users can run a separate instance with fixed-node HTTP/SOCKS listeners,
TUN/DNS disabled, without changing existing selectors or system routing.
The pool does not import subscriptions or include any usable nodes.

Inspect `http://127.0.0.1:18100/health` locally; never expose the pool gateway
publicly. The Web Panel is read-only and does not edit pool configuration.
Private pool files are excluded from Git/Docker builds, but always inspect
staged changes and never force-add credentials.

For Docker, mount private configuration read-only and use proxy addresses
reachable from inside the container: container loopback is not host loopback.
See the [pool guide (Chinese)](./docs/zh/proxy-pool.md) for examples and all limits.

## New API Integration

Create an OpenAI-compatible channel with base URL `http://127.0.0.1:10000`
(without `/v1`, when both services share host networking), the proxy's
`API_KEY`, and model IDs from `/v1/models`. Use private service addresses
instead of loopback across containers. Configure model pricing explicitly;
free upstream models do not automatically imply zero New API charges.
Clients keep using their New API URL/token; pool failover is transparent.

## 🔌 API Endpoints

| Method | Path | Description |
|:-----|:-----|:-----|
| `GET` | `/health` | Health check |
| `GET` | `/health/details` | Structured diagnostics (toggle/auth configurable) |
| `GET` | `/metrics` | Prometheus metrics (toggle/auth configurable) |
| `GET` | `/panel` | Web Panel page (off by default; enable with `OPENCODE_WEB_PANEL_ENABLED=true`) |
| `GET` | `/panel/data.json` | Web Panel data feed (Bearer/PUBLIC_DIAGNOSTICS gated, never returns secret values) |
| `GET` | `/v1/models` | Model list |
| `POST` | `/v1/chat/completions` | Chat Completions |
| `POST` | `/v1/responses` | Responses API |
| `POST` | `/v1/messages` | Anthropic Messages API (Claude SDK compatible) |
| `GET` | `/admin/keys` | Multi-user key list and usage (admin auth, available once `API_KEYS` is configured) |
| `POST` | `/admin/keys` | Add a user key at runtime (admin auth) |
| `DELETE` | `/admin/keys/:name` | Remove a user key (admin auth) |

Model names: `opencode/big-pickle`, `gpt5-nano` (auto-resolved to `gpt-5-nano`), `opencode/gpt5-nano`.

> 📖 See [API Reference](./docs/en/api-reference.md)
>
> 👥 Full details on multi-user keys, per-key usage metering, and the admin endpoints: [Configuration](./docs/en/configuration.md#-multi-user-api-keys).

## 🖥️ Web Panel

Set `OPENCODE_WEB_PANEL_ENABLED=true` (or `"WEB_PANEL_ENABLED": true` in config.json) and open `http://127.0.0.1:10000/panel` in a browser for a read-only dashboard: runtime status (status/uptime/backend URL), the model list, and backend diagnostics (tool-mode counters, cache state). Dark theme, zero external dependencies — no external CSS/JS, CSP locked to same-origin.

With `API_KEY` configured, enter the proxy key in the page (kept in the browser's localStorage and used to call `/panel/data.json`); with `PUBLIC_DIAGNOSTICS=true` or no `API_KEY` no key is needed. When the panel is disabled both routes return 404, and the data feed never returns any secret values. See [Configuration](./docs/en/configuration.md).

## 🔧 Troubleshooting

- **Requests hang but `/v1/models` works** — set `OPENCODE_USE_ISOLATED_HOME=false` to reuse the local login state
- **Model not found** — run `curl http://127.0.0.1:10000/v1/models` to confirm the model ID
- **No reasoning output** — use the Responses API with `stream: true` and send `reasoning.effort`

> 📖 More: [Troubleshooting](./docs/en/troubleshooting.md)

## 📚 Documentation

| Document | Description |
|:-----|:-----|
| [Getting Started](./docs/en/getting-started.md) | Install and first run |
| [Configuration](./docs/en/configuration.md) | All env vars and config.json |
| [API Reference](./docs/en/api-reference.md) | Endpoints, params, error codes |
| [Docker Deployment](./docs/en/docker.md) | Deployment and operations |
| [Troubleshooting](./docs/en/troubleshooting.md) | Common issues |
| [Development](./docs/en/development.md) | Local development and testing |

## 📄 License

MIT · see [LICENSE](./LICENSE.md)

## 🙏 Acknowledgements

- [TiaraBasori/opencode2api](https://github.com/TiaraBasori/opencode2api) — upstream project
- [dxxzst/opencode-to-openai](https://github.com/dxxzst/opencode-to-openai)
- [jasonxu114514/opencode2api](https://github.com/jasonxu114514/opencode2api)
- [lucasliet/opencode-openai-proxy](https://github.com/lucasliet/opencode-openai-proxy)
