# OpenCode2API

<p align="center">
  <img src="https://img.shields.io/badge/version-2.5.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/Node.js-18+-orange" alt="Node">
</p>

简体中文 | [English](./README.en.md)

把本地 [OpenCode](https://opencode.ai) 运行时转换为 OpenAI 兼容 API 网关，在兼容客户端或 New API 中使用 OpenCode Zen 提供的模型。

本仓库是 [TiaraBasori/opencode2api](https://github.com/TiaraBasori/opencode2api) 的 fork，新增**项目独立的出站代理池与失败自动切换**，支持 HTTP / HTTPS / SOCKS 代理，不修改系统代理或其他服务的出口。

> 免费模型的可用性和限流由上游决定，并非不限量；切换出口不保证解决账号或模型级限流。

## ✨ 功能特性

- **OpenAI 兼容** — `/v1/models`、`/v1/chat/completions`、`/v1/responses`，完整 SSE 流式输出
- **推理控制** — 支持 `reasoning_effort` 与 `reasoning: {"effort": "high"}`
- **会话续接** — Responses API 支持 `previous_response_id`，30 分钟 TTL，到期自动清理上游会话
- **外部工具桥接** — 客户端传入 `tools`，代理返回标准 `tool_calls` / `function_call`，不触发 OpenCode 内置工具
- **内置工具 allowlist** — 请求未带 `tools` 时，仅放行 `OPENCODE_INTERNAL_ALLOWED_TOOLS` 声明的内置工具
- **可观测性** — `/health/details` 结构化诊断，`/metrics` Prometheus 指标
- **Web Panel** — 可选内置面板（`/panel`），只读展示状态/模型/诊断，默认关闭
- **独立代理池** — HTTP / HTTPS / SOCKS 出口；429、408、5xx 或连接失败时自动切换，节点冷却、有限重试，不重放已开始的流式响应
- **Docker 部署** — 一键启动，自动拉起 OpenCode 后端

## 🚀 快速开始

### Docker（推荐）

```bash
git clone https://github.com/Mufumoca/OpenCode2API.git
cd OpenCode2API
cp .env.example .env        # 编辑 .env，必填 API_KEY 与 OPENCODE_SERVER_PASSWORD
docker compose up -d --build
curl http://127.0.0.1:10000/health
```

> 使用 `--build` 从本 fork 源码构建，避免误用尚未包含本仓库新功能的上游镜像。

> 默认 Compose 配置不挂载宿主机项目目录，避免覆盖镜像内已安装的 `node_modules`。需要源码热更新时，请单独使用开发用的 Compose 覆盖文件。

### Node.js（本地开发）

```bash
# 安装 OpenCode CLI
npm install -g opencode-ai@1.19.0
# 或 curl -fsSL https://opencode.ai/install | bash

git clone https://github.com/Mufumoca/OpenCode2API.git
cd OpenCode2API
npm install
cp config.json.example config.json
npm start
```

## 💡 使用示例

### Chat Completions

```bash
curl -X POST http://127.0.0.1:10000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/big-pickle",
    "messages": [{"role": "user", "content": "你好!"}],
    "stream": false
  }'
```

### Responses API（流式 + 推理）

```bash
curl -N -X POST http://127.0.0.1:10000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt5-nano",
    "input": "用一句话打招呼",
    "reasoning": {"effort": "high"},
    "stream": true
  }'
```

### 外部工具

```bash
curl -X POST http://127.0.0.1:10000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/big-pickle",
    "messages": [{"role": "user", "content": "帮我获取 https://example.com 的标题"}],
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

模型决定调用工具时，非流式响应返回 `message.tool_calls`，流式响应返回 `delta.tool_calls`。

### Anthropic Messages API（/v1/messages）

面向 Claude SDK / Anthropic 客户端的端点。认证使用 `x-api-key` header（`Authorization: Bearer` 亦可用），模型决定调用工具时返回 `tool_use` 内容块。

```bash
curl -X POST http://127.0.0.1:10000/v1/messages \
  -H "x-api-key: ***" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/big-pickle",
    "max_tokens": 1024,
    "system": "You are concise.",
    "messages": [{"role": "user", "content": "你好!"}],
    "stream": true
  }'
```

工具往返（工具结果以 `tool_result` 块回传）：

```bash
curl -X POST http://127.0.0.1:10000/v1/messages \
  -H "x-api-key: ***" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode/big-pickle",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "帮我获取 https://example.com 的标题"}],
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

响应包含 `{"type":"tool_use","id":"…","name":"web_fetch","input":{…}}` 内容块（`stop_reason: "tool_use"`）；把工具结果作为 `{"type":"tool_result","tool_use_id":"…","content":"…"}` 用户块发回即可继续对话。`stream: true` 时按 Anthropic SSE 事件序输出 `message_start` → `content_block_*` → `message_delta` → `message_stop`。

## ⚙️ 配置

| 环境变量 | 默认值 | 说明 |
|:--------|:-------|:-----|
| `API_KEY` | (空) | 代理的 Bearer 认证密钥 |
| `OPENCODE_API_KEYS` | (空) | 多用户 API key 列表，`name:key` 逗号分隔（详见 [配置详解](./docs/zh/configuration.md)） |
| `OPENCODE_SERVER_PASSWORD` | (空) | OpenCode 后端密码 |
| `OPENCODE_PROXY_PORT` / `PORT` | `10000` | 代理端口 |
| `OPENCODE_SERVER_PORT` | `10001` | 后端端口（未显式配置 `OPENCODE_SERVER_URL` 时生效） |
| `OPENCODE_SERVER_URL` | `http://127.0.0.1:10001` | 后端地址 |
| `OPENCODE_DISABLE_TOOLS` | `true` | 禁用 OpenCode 内置工具 |
| `OPENCODE_INTERNAL_ALLOWED_TOOLS` | (空) | 请求未带 `tools` 时放行的内置工具，逗号分隔 |
| `OPENCODE_PROXY_OMIT_SYSTEM_PROMPT` | `false` | 忽略传入的 system prompt |
| `OPENCODE_PROXY_AUTO_CLEANUP_CONVERSATIONS` | `false` | 自动清理会话存储 |
| `OPENCODE_USE_ISOLATED_HOME` | `false` | 使用隔离的 OpenCode 配置目录 |
| `OPENCODE_WEB_PANEL_ENABLED` | `false` | 开启内置 Web Panel（`/panel`） |
| `OPENCODE_PROXY_POOL_CONFIG` | (空，关闭) | 私有代理池 JSON 文件路径，详见 [代理池指南](./docs/zh/proxy-pool.md) |
| `OPENCODE_PROXY_DEBUG` | `false` | 调试日志 |

> 📄 完整配置见 [配置详解](./docs/zh/configuration.md)

推荐生产配置：

```env
API_KEY=your-secret-key
OPENCODE_SERVER_PASSWORD=your-password
OPENCODE_DISABLE_TOOLS=true
OPENCODE_INTERNAL_ALLOWED_TOOLS=web_fetch
OPENCODE_PROXY_OMIT_SYSTEM_PROMPT=true
OPENCODE_PROXY_AUTO_CLEANUP_CONVERSATIONS=true
```

## 出站代理池与自动切换

默认关闭，不需要代理时直接使用普通启动方式。启用后调用链为：

```text
客户端 / New API → OpenCode2API → OpenCode → 本地切换网关 → 代理出口 → Zen
```

### Node.js 启用

```bash
cp proxy-pool.example.json proxy-pool.json
# 编辑 proxy-pool.json，填入自己提供的代理入口
chmod 600 proxy-pool.json
OPENCODE_PROXY_POOL_CONFIG=./proxy-pool.json npm start
```

配置示例（以下仅为本机占位入口，需要自行启动对应代理）：

```json
{
  "listenPort": 18100,
  "maxAttempts": 3,
  "cooldownMs": 60000,
  "nodes": [
    { "name": "exit-a", "proxy": "http://127.0.0.1:18110" },
    { "name": "exit-b", "proxy": "socks5h://127.0.0.1:18111" }
  ]
}
```

也可在 `config.json` 中设置 `"PROXY_POOL_CONFIG": "./proxy-pool.json"`。
Docker 部署需要只读挂载私有配置；容器内的 `127.0.0.1` 不代表宿主机，
具体配置见 [代理池指南](./docs/zh/proxy-pool.md)。

### 切换规则与隔离

| 场景 | 行为 |
|:-----|:-----|
| 正常请求 | 保持当前出口，不为每次请求轮换 IP |
| 429、408、5xx、连接失败或首响应超时 | 冷却当前节点，尝试其他可用出口 |
| 400、401、403 等请求/认证错误 | 原样返回，不盲目切换 |
| 已转发响应头或流式内容 | 不自动重放，避免重复输出 |
| 所有出口冷却 | 返回 503 和 `Retry-After`，不回落直连 |

每个上游 HTTP 请求默认最多尝试 **3 个出口**，失败节点默认冷却 **60 秒**；
上游 `Retry-After` 更长时遵守其要求。OpenCode 和 API 网关也可能重试，
因此这不是整条调用链的总尝试次数上限。网络失败后的重试可能造成重复推理或计费。

仅覆盖本项目启动的 OpenCode 子进程的 `opencode` provider 出口，需要
`MANAGE_BACKEND=true`，不要复用已运行的外部后端。每次尝试绑定固定代理，
不会因另一个请求切换节点而更改现有连接。

VLESS、Reality、Hysteria2、Shadowsocks 节点可通过**独立 Mihomo 实例**转为
固定节点的 HTTP/SOCKS 入口；本功能不导入订阅，不修改已有 Mihomo 的选择、系统 DNS 或路由。

诊断：`curl http://127.0.0.1:18100/health`（默认端口，仅本机监听，不要暴露公网）。
当前 Web Panel 为只读状态面板，不能编辑代理池。

> **隐私**：仓库只提供示例，不包含任何可用节点或密钥。私有 `proxy-pool*.json`
> （示例除外）、`private/` 等已从 Git 和 Docker 构建上下文排除；提交前仍应检查暂存区，
> 不要强制添加包含凭据的文件。

## 接入 New API

在 New API 后台新增 OpenAI 兼容渠道：

| 配置项 | 填写方式 |
|:-----|:-----|
| Base URL | `http://127.0.0.1:10000`，不带 `/v1`，前提是两个服务在同一主机网络 |
| 密钥 | OpenCode2API 配置中的 `API_KEY` |
| 模型 | 从 `/v1/models` 同步或填写实际模型 ID，例如 `opencode/big-pickle` |
| 计费 | 根据自己的需求配置模型价格；上游免费不代表 New API 自动零费率 |

如果服务位于不同容器，使用可互通的私有网络地址，而非各自的 `127.0.0.1`。
客户端继续使用 **New API 的访问地址和令牌**，启用代理池后无需额外修改客户端。

## 🔌 API 端点

| 方法 | 路径 | 说明 |
|:-----|:-----|:-----|
| `GET` | `/health` | 健康检查 |
| `GET` | `/health/details` | 结构化诊断（可配置开关/鉴权） |
| `GET` | `/metrics` | Prometheus 指标（可配置开关/鉴权） |
| `GET` | `/panel` | Web Panel 页面（默认关闭，`OPENCODE_WEB_PANEL_ENABLED=true` 开启） |
| `GET` | `/panel/data.json` | Web Panel 数据源（Bearer/PUBLIC_DIAGNOSTICS 门禁，永不返回密钥值） |
| `GET` | `/v1/models` | 模型列表 |
| `POST` | `/v1/chat/completions` | Chat Completions |
| `POST` | `/v1/responses` | Responses API |
| `POST` | `/v1/messages` | Anthropic Messages API（兼容 Claude SDK） |
| `GET` | `/admin/keys` | 多用户 key 列表与用量（管理员认证，配置 `API_KEYS` 后可用） |
| `POST` | `/admin/keys` | 运行时新增用户 key（管理员认证） |
| `DELETE` | `/admin/keys/:name` | 移除用户 key（管理员认证） |

模型名称写法：`opencode/big-pickle`、`gpt5-nano`（自动解析为 `gpt-5-nano`）、`opencode/gpt5-nano`。

> 📖 详见 [API 参考](./docs/zh/api-reference.md)
>
> 👥 多用户 key、分 key 用量统计与管理端点的完整说明见 [配置详解](./docs/zh/configuration.md#-多用户-api-keys)。

## 🖥️ Web Panel

设 `OPENCODE_WEB_PANEL_ENABLED=true`（或在 config.json 设 `"WEB_PANEL_ENABLED": true`）后，浏览器访问 `http://127.0.0.1:10000/panel` 即可查看只读仪表盘：运行状态（状态/uptime/后端地址）、模型列表、后端诊断（工具模式计数、缓存状态）。页面深色主题、零外部依赖（无外链 CSS/JS，CSP 限定同源）。

配置 `API_KEY` 后，在页面输入代理密钥即可（保存在浏览器 localStorage，用于请求 `/panel/data.json`）；`PUBLIC_DIAGNOSTICS=true` 或未配置 `API_KEY` 时无需输入。面板关闭时两个路由均为 404，数据端点永远不会返回任何密钥值。详见 [配置详解](./docs/zh/configuration.md)。

## 🔧 故障排查

- **请求卡住但 `/v1/models` 正常** — 设 `OPENCODE_USE_ISOLATED_HOME=false` 复用本地登录态
- **模型找不到** — `curl http://127.0.0.1:10000/v1/models` 确认模型 ID
- **没有推理输出** — 用 `stream: true` 的 Responses API，并传 `reasoning.effort`

> 📖 更多见 [故障排查](./docs/zh/troubleshooting.md)

## 📚 文档

| 文档 | 说明 |
|:-----|:-----|
| [快速开始](./docs/zh/getting-started.md) | 安装与首次运行 |
| [配置详解](./docs/zh/configuration.md) | 全部环境变量与 config.json |
| [代理池配置](./docs/zh/proxy-pool.md) | HTTP/SOCKS 出口、Mihomo、失败切换与私密配置 |
| [API 参考](./docs/zh/api-reference.md) | 端点、参数与错误码 |
| [Docker 部署](./docs/zh/docker.md) | 部署与运维 |
| [故障排查](./docs/zh/troubleshooting.md) | 常见问题 |
| [开发指南](./docs/zh/development.md) | 本地开发与测试 |

## 📄 许可证

MIT · 详见 [LICENSE](./LICENSE.md)

## 🙏 致谢

- [TiaraBasori/opencode2api](https://github.com/TiaraBasori/opencode2api) — 本 fork 的上游项目
- [dxxzst/opencode-to-openai](https://github.com/dxxzst/opencode-to-openai)
- [jasonxu114514/opencode2api](https://github.com/jasonxu114514/opencode2api)
- [lucasliet/opencode-openai-proxy](https://github.com/lucasliet/opencode-openai-proxy)
