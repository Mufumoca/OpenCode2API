# 出站代理池与失败切换

可选功能，默认关闭。只有本项目启动的 OpenCode 子进程的 `opencode`
provider 使用该出口；不会修改系统代理、DNS、路由或现有 Mihomo 的节点选择。

```text
客户端 / New API -> OpenCode2API -> OpenCode -> 本地切换网关 -> 独立出口 -> Zen
```

## 配置

1. 复制 `proxy-pool.example.json` 为 `proxy-pool.json`。
2. 在文件的 `nodes` 中填写自己的 HTTP、HTTPS 或 SOCKS 代理 URL。
3. 设置环境变量 `OPENCODE_PROXY_POOL_CONFIG=./proxy-pool.json`，然后正常 `npm start`。
   也可以在 config.json 中设置 `PROXY_POOL_CONFIG`；环境变量优先。

需要 `MANAGE_BACKEND=true`，使用本项目新启动的后端。不要复用一个已经运行、
没有该 provider 配置的外部 OpenCode 后端。默认切换网关仅监听
`127.0.0.1:18100`，不能与 API/后端端口相同，不要将该端口映射到公网。

代理 URL 示例（仅占位，不包含真实节点）：

```text
http://127.0.0.1:18110
socks5h://127.0.0.1:18111
http://USERNAME:PASSWORD@proxy.example.invalid:8080
```

用户名和密码中的特殊字符必须 URL 编码。支持 HTTP、HTTPS、SOCKS4、SOCKS4a、
SOCKS5、SOCKS5h；远端 DNS 可使用 socks5h。

## Mihomo

本功能消费独立的代理入口，不导入或管理订阅。对于 VLESS、Reality、Hysteria2、
Shadowsocks 等节点，可以另起一个仅供本项目使用的 Mihomo 实例：关闭 TUN 和 DNS，
不给系统设置代理；使用多个固定节点的 mixed listener。

```yaml
# 放在自己的私有配置里，proxies 节点由使用者自行提供。
allow-lan: false
bind-address: 127.0.0.1
tun:
  enable: false
dns:
  enable: false
listeners:
  - name: exit-a
    type: mixed
    listen: 127.0.0.1
    port: 18110
    proxy: YOUR_NODE_A
  - name: exit-b
    type: mixed
    listen: 127.0.0.1
    port: 18111
    proxy: YOUR_NODE_B
rules:
  - MATCH,REJECT
```

不要把不同 listener 都指向同一个可变 select 组，否则无法保证并发请求的出口隔离。
不同节点也可能最终使用相同公网 IP，应自行核实。

## 失败规则

- 每个新请求按 round-robin 循环选择出口；429、408、5xx、连接或首响应超时后，尝试下一个可用出口。
- 每个上游 HTTP 请求默认最多尝试 3 个出口，可设置 `maxAttempts`（1–10）。
- 节点连续失败默认达到 2 次（`failureThreshold`）后冷却 60000ms（`cooldownMs`），成功后清零连续失败计数；429 立即冷却，`Retry-After` 更长时遵守上游要求。冷却到期后自动重新参与循环。
- 每次尝试使用固定代理 agent，不改变其他并发连接的出口。
- 400、401、403 等请求或认证错误不重试；已经转发响应头或流式内容后绝不重放。
- 全部出口冷却时返回 503 和 Retry-After；没有直连兜底。
- 首响应超时默认 60000ms，流式空闲超时默认 120000ms；请求体上限 32MiB。
- `enabled: false` 的节点不参与选择；修改配置需要重启服务。

OpenCode 和网关自身也可能重试，因此 `maxAttempts` 不是端到端总重试次数上限。
请求可能已经被上游处理而响应丢失，网络失败重试存在重复推理/计费风险。
429 也可能是账号或模型限流，换 IP 不保证恢复，应遵守服务条款和限流规则。

本地诊断：`curl http://127.0.0.1:18100/health`。输出仅含节点别名、计数与冷却时间，
不含代理 URL/凭据。日志不记录提示词、代理 URL 或上游错误正文。

## Docker

私有配置必须只读挂载，不要 COPY 到镜像。例如 Compose 覆盖文件：

```yaml
services:
  opencode2api:
    environment:
      OPENCODE_PROXY_POOL_CONFIG: /run/secrets/proxy-pool.json
    volumes:
      - ./proxy-pool.json:/run/secrets/proxy-pool.json:ro
```

容器内的 `127.0.0.1` 不是宿主机。使用同一私有容器网络中的独立代理服务及其服务名，
或者明确配置自己的宿主机网络访问方式；不要公开代理端口。

## 私密配置

`proxy-pool*.json`（示例除外）、`private/`、`.env.*`（示例除外）、
`*.local.yaml` 和 `*.local.yml` 已加入 Git 忽略及 Docker 构建上下文排除。
建议私有文件权限 0600。忽略规则不是保密保证，不要使用 `git add -f` 添加配置，
提交前检查暂存区。节点别名会出现在日志中，不要在别名中填写凭据。

关闭功能：取消 `OPENCODE_PROXY_POOL_CONFIG` / `PROXY_POOL_CONFIG`，重启服务。
