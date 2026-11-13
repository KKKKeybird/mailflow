# 升级到 fork v4.4.0

本版包含上游两步验证安全修复，并将 Redis 会话/短期键迁到 PostgreSQL、Docker 前端改为 Caddy。镜像仍使用 `ghcr.io/kkkkeybird/mailflow-backend` 和 `ghcr.io/kkkkeybird/mailflow-frontend`。

升级前备份数据库及现有 Compose、`.env` 和证书；保留原来的数据库密码、`ENCRYPTION_KEY`、`SESSION_SECRET`，不要重新生成。请使用本 fork 的新版 [docker-compose.ghcr.yml](../docker-compose.ghcr.yml)，将自己已有的端口、卷和环境配置合并进去，不要用示例 `.env` 覆盖真实配置。

- 新增 `0076_sessions_and_kv_store`、`0077_oidc_idp_enforces_mfa` 两个迁移，自动执行。原来所有迁移文件名不变。
- 原有登录会话不迁移，升级后需重新登录一次；邮箱、代理和 MCP 令牌数据仍在数据库中。
- Redis 服务不再使用。采用新版 Compose 后，执行 `docker compose pull` 和 `docker compose up -d --remove-orphans`。这会清理同一 Compose 项目内旧的 Redis，以及旧 `https` profile 的独立 Caddy 容器；先确认自己的额外服务仍在 Compose 中。无需为启动新版而删除数据卷。

## 选择前端 TLS 模式

| 部署方式 | 设置 |
| --- | --- |
| 原来由 MailFlow 自签证书提供 HTTPS | 默认 `TLS_MODE=self-signed`，已有证书继续使用。 |
| 原来使用 `https` profile 自动签证书 | 在更新前设置 `TLS_MODE=letsencrypt`，保留 `DOMAIN`、`ACME_EMAIL`；移除仅为旧 profile 设置的 `TRUST_PROXY_HOPS=2`。保留 `docker-compose.https.yml` 覆盖文件也可。不要误切成自签模式，否则已有 HSTS 的浏览器可能拒绝访问。 |
| 使用 NginxWebUI 等自建反向代理 | 可设置 `TLS_MODE=off`，让外层代理转发到新版前端 HTTP 端口，保留 `X-Forwarded-Proto: https`。核对 `APP_HTTP_PORT` 的实际映射和完整代理跳数；普通 API 超时应至少 120 秒。 |

旧 `NGINX_TLS=off` 仍兼容；旧 `/etc/nginx/ssl` 路径挂载的证书也兼容。自定义 `nginx.conf` 挂载及 `NGINX_BASE` 不再配置新版 Docker 前端；如需替换基础镜像，使用 `FRONTEND_BASE`。Caddy 的证书数据卷和配置以新版 Compose 为准。

## 登录行为变化

启用验证器的用户不能再用恢复邮箱验证码代替验证器；SSO 登录也会按上游规则要求用户自己的验证器/管理员两步验证策略。仅在身份提供方确实强制 MFA 时，管理员才应开启该提供方的“Provider enforces MFA”。

如果升级后管理员无法登录，可在服务器本地使用 `node src/cli/authRecovery.js sign-in-code <username>` 或 `disable-2fa <username>`，具体见 README。生成的验证码属于凭据，勿贴进聊天、日志附件或 PR。

## 升级后检查与回退

检查 `/api/health`、重新登录、两个 Gmail 的实际同步/计数观测、删除/标垃圾及 MCP 授权。Gmail 代理的空闲池探测缓解仍保留，不能据此认定外部 TLS 路由已经修复。

如需回到 v4.3.1，同时使用对应的旧版 Compose 和镜像摘要，恢复 Redis 服务；届时也会重新登录一次。不要手工删除迁移记录或重命名已执行的迁移。实际生产升级及回退由部署方执行，发布镜像不会自动替换 NAS 容器。
