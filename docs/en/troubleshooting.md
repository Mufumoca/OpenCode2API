# 🔧 Troubleshooting

## ❓ FAQ

### Requests hang, but `/v1/models` works

Set `OPENCODE_USE_ISOLATED_HOME=false` so OpenCode reuses the host login state:

```env
OPENCODE_USE_ISOLATED_HOME=false
```

### Free models fail with `free tier can only be used from within OpenCode`

The backend is not loading the tool-lock plugin. Let the proxy start the backend (default `MANAGE_BACKEND=true`), or add `plugin/opencode2api-tool-lock.js` to your own backend's `plugin` config.

### Model not found (`model_not_found`)

Check the model ID against the backend:

```bash
curl http://127.0.0.1:10000/v1/models
```

### Sent `reasoning_effort` but got no reasoning output

Use the Responses API with `stream: true`, and pass `reasoning.effort` or `reasoning_effort`.

### Client unexpectedly triggers OpenCode built-in tools

Keep `OPENCODE_DISABLE_TOOLS=true`.

### Port conflict (`EADDRINUSE`)

```bash
# Check usage
lsof -i :10000
lsof -i :10001

# Change ports
OPENCODE_PROXY_PORT=10002
OPENCODE_SERVER_PORT=10003
```

### OpenCode not installed (`Cannot verify OpenCode installation`)

```bash
npm install -g opencode-ai@1.19.0
# Or curl -fsSL https://opencode.ai/install | bash
```

You can also point to the full binary path via `OPENCODE_PATH`.

### Empty model list / completions fail, logs show `/config/providers` errors

The backend is OpenCode 2.x. 2.x moved the server API under `/api/*` and removed the 1.x routes used by the bundled SDK, so it is incompatible with this proxy (the proxy rejects it at startup: `OpenCode backend 2.x is not compatible`). Downgrade to the newest 1.x release:

```bash
npm install -g opencode-ai@1.19.0
# or point OPENCODE_PATH at a 1.x binary
```

There is no JS SDK for 2.x yet; do not upgrade the backend until the proxy supports it.

### Docker container fails to start

```bash
docker compose logs
netstat -tulpn | grep -E '10000|10001'
```

### Auth failure (`401 Unauthorized`)

Confirm the request carries the same Bearer token as `API_KEY`:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" ...
```

## 🔍 Debug Mode

```env
OPENCODE_PROXY_DEBUG=true
```

Debug logs print detailed request and response info.

## 🆘 Get Help

- 🐛 [GitHub Issues](https://github.com/TiaraBasori/opencode2api/issues)
