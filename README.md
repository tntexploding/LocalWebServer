# Local Automation Server

Local Automation Server 是一个本地 HTTP/WebSocket 网关与自动化服务。它负责管理收发端点、将消息标准化为事件、按声明式规则匹配事件，并通过受控队列执行命令、HTTP 发送和 WebSocket 发送动作。

> [!WARNING]
> 本项目按本地优先的单用户信任模型设计，不应直接暴露到公网。跨主机使用前请先阅读
> [安全说明](SECURITY.md)，并配置 TLS 终止、访问控制和主机防火墙。

## 功能概览

- 为不同 IP、端口和路径创建 HTTP/WS 服务端。
- 通过完整 URL 创建 HTTP/WS 客户端。
- 使用 YAML 管理端点、自动化流程、动作和运行设置。
- 使用 JSON 消息模板校验接收内容、提取字段和生成发送表单。
- 通过起点、动作、逻辑分支和结束点搭建可视化自动化流程。
- 按来源、消息模板、事件类型和一个或多个 JSONPath 条件触发流程。
- 在流程中执行命令或脚本、发送 HTTP/WS、等待消息、通知用户或等待选择。
- 使用 `${{ ... }}` 将触发消息、节点结果和流程输入传递给后续动作。
- 为 HTTP/WS 发送提供超时、指数退避重试、幂等键和持久 WS 客户端。
- QQ-AIC 接收协议区分文字、图片、视频、文件、音频、链接与合并转发，并可展示插件持久化后的媒体引用。
- 持久化调度状态，支持 IANA 时区与服务重启后的错过执行策略。
- 记录可轮转事件日志、节点级执行时间线与队列状态，并通过中文/英文 WebUI 管理。
- 原子保存配置，保存前校验跨文件引用，并提供带完整性摘要的本机历史恢复。
- 将管理、操作和只读令牌与普通配置分离，限制控制 API 来源和浏览器来源。
- 限制命令工作目录、Shell 使用方式和动作并发数。

## 环境要求

- 推荐 Node.js 24.18.1 或更新的 24.x；其他版本会显示兼容性提示，但不会阻止启动。
- npm 10 或更高版本。
- Windows、macOS 或 Linux；命令动作本身可能依赖操作系统。

## 获取与运行

### Windows 便携版

从 [Releases](https://github.com/tntexploding/LocalWebServer/releases) 下载
`local-automation-server-win-x64.zip` 及其 `.sha256` 文件，核对摘要后解压：

```powershell
Get-FileHash -Algorithm SHA256 .\local-automation-server-win-x64.zip
```

首次运行执行 `initialize.cmd`，随后使用 `start.cmd` 启动。便携包固定并校验 Node.js
运行时，且附带 CycloneDX SBOM 与逐文件 SHA-256 清单。

### 从源码运行

```powershell
npm ci --ignore-scripts
Copy-Item config/app.example.yaml config/app.yaml
Copy-Item config/web.example.yaml config/web.yaml
Copy-Item config/endpoints.example.yaml config/endpoints.yaml
Copy-Item config/rules.example.yaml config/rules.yaml
Copy-Item config/actions.example.yaml config/actions.yaml
npm run secrets:init
npm run dev
```

已有本机配置时无需覆盖。实际配置和消息模板已被 Git 忽略，详细说明见 [本机配置说明](config/README.md)。

仓库只包含默认禁用且不含真实标识符的 `*.example.yaml`。本机配置、消息模板、媒体、
令牌、日志、运行数据、测试产物和便携发行物都不会进入 Git；`npm run audit:repo` 会同时
检查当前文件、忽略边界和 Git 历史。

开发模式会同时启动后端和前端：

- WebUI：`http://127.0.0.1:4177/ui/`
- 后端 API：`http://127.0.0.1:4789`

启动器会读取 `config/app.yaml` 中的实际后端地址和 `config/web.yaml` 中的开发 WebUI 地址，先确认 WebUI 来源位于 `security.corsOrigins` 并检查端口占用，再并行启动后端与 Vite、分别等待两端就绪。按 `Ctrl+C` 或任一子服务异常退出时，前后端进程会一并关闭。

如需分别排查，可使用 `npm run dev:server` 和 `npm run dev:web`。

如果页面显示接口诊断，请先看失败类型：`network` 表示后端地址不可达，`HTTP 401/403` 表示后端已在线但 API 令牌缺失、失效或权限不足。管理员令牌保存在被 Git 忽略的 `config/secrets.yaml` 中。

生产式本地运行会先构建全部工作区，再由后端托管 WebUI：

```powershell
npm start
```

随后打开 `http://127.0.0.1:4789/ui/`。

### Docker 容器

仓库已提供安全收敛的容器化基线，可在安装 Docker Compose 的环境中构建并运行：

```sh
docker compose up --build -d
docker compose ps
```

随后打开 `http://127.0.0.1:4789/ui/`。首次启动会在命名数据卷中复制默认禁用的脱敏
配置并随机生成三种角色令牌；已有配置不会被覆盖。查看本机管理员令牌可执行：

```sh
docker compose exec las cat /var/lib/las/config/secrets.yaml
```

Compose 默认只把控制端口发布到宿主机回环地址，并以非 root 用户、只读根文件系统和移除
Linux capabilities 的方式运行。额外 HTTP/WS 监听端口必须逐项发布；容器中的命令动作也
只会操作容器及显式挂载的目录。HTTP/WS 客户端可通过“精确服务名 + 解析地址/CIDR +
端口”三项白名单访问 Compose 服务或宿主网关。完整网络、数据卷和安全说明见
[Docker 部署指南](doc/docker.md)。

GitHub Actions 会在 `main` 和版本标签通过质量门禁后发布 `linux/amd64`、`linux/arm64`
镜像到 `ghcr.io/tntexploding/localwebserver`。使用已发布镜像时可设置 `LAS_IMAGE`，先拉取
再禁止 Compose 本地构建：

```sh
export LAS_IMAGE=ghcr.io/tntexploding/localwebserver:edge
docker compose pull las
docker compose up --no-build -d
```

## 基本使用

1. 在“端点”页面创建 HTTP/WS 服务端或客户端。
2. 为 HTTP 端点选择消息模板，或直接使用原始 JSON。
3. 在“动作”页面配置并测试可复用的命令、脚本、发送、交互或等待动作。
4. 在“自动化”页面选择消息或时间触发器，并连接动作、判断分支和结束点。
5. 在“日志”页面查看接收、发送、匹配和执行结果。

`npm run secrets:init` 会生成忽略版本控制的 `config/secrets.yaml`，并让普通配置只保留
`${secret:...}` 引用。调用控制 API 时使用相应角色的请求头：

```http
x-las-token: <your-local-admin-operator-or-read-token>
```

管理令牌可保存和恢复配置；操作令牌可试运行、发送、重放和取消；只读令牌只能查询。
脱敏示例默认要求只读令牌。WebUI 只在当前浏览器会话中保存输入的令牌，关闭会话后不会继续保留。

## 配置文件

| 文件                      | 用途                                                  |
| ------------------------- | ----------------------------------------------------- |
| `config/app.yaml`         | 本机 API 监听、安全边界、并发和日志路径，不进入 Git。 |
| `config/web.yaml`         | 开发 WebUI 的监听地址与端口，不进入 Git。             |
| `config/endpoints.yaml`   | 本机 HTTP/WS 服务端与客户端，不进入 Git。             |
| `config/rules.yaml`       | 本机消息/时间触发器和自动化流程，不进入 Git。         |
| `config/actions.yaml`     | 本机可复用动作库，不进入 Git。                        |
| `config/templates/*.json` | 本机消息协议与字段定义，不进入 Git。                  |
| `config/secrets.yaml`     | 本机令牌与密钥，不进入 Git。                          |
| `config/*.example.yaml`   | 可以提交的脱敏且默认禁用初始化示例。                  |

实际配置不会在格式化或清理命令中被重置。详细说明见
[配置指南](doc/configuration.md)、[自动化流程](doc/workflow_automation.md) 和
[消息模板标准](doc/message_template_standard.md)。

## 常用命令

| 命令                               | 作用                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                      | 同时启动后端和 Vite WebUI。                                             |
| `npm start`                        | 构建并启动后端托管版本。                                                |
| `npm run secrets:init`             | 生成或迁移本机令牌到独立密钥文件。                                      |
| `npm run config:normalize`         | 从脱敏模板补齐旧版 `app.yaml` 的缺失字段。                              |
| `npm run check`                    | 检查格式、风格、类型、构建并运行全部测试。                              |
| `npm run audit:repo`               | 检查当前文件及 Git 历史中的配置、凭据模式和运行时硬编码地址。           |
| `npm run audit:lock`               | 离线检查生产依赖来源、完整性、许可证和安装脚本。                        |
| `npm run audit:dependencies`       | 向 npm 查询漏洞并验证依赖签名和来源证明。                               |
| `npm run test:unit`                | 运行包级单元和组件测试。                                                |
| `npm run test:e2e`                 | 通过构建入口和公共协议运行独立进程测试。                                |
| `npm run test:browser`             | 使用 Chrome 验证生产 WebUI 交互。                                       |
| `npm run test:container`           | 构建隔离镜像并验证安全运行、持久化及受控的容器间 HTTP 访问。            |
| `npm run test:container:platforms` | 使用临时 Buildx builder 验证 amd64/arm64 构建，不推送镜像。             |
| `npm run package:portable`         | 使用固定且校验过的 Node.js 生成带 SBOM、清单和校验和的 Windows 便携包。 |
| `npm run package:verify`           | 重新验证便携目录、运行时、逐文件清单和压缩包摘要。                      |
| `npm run startup:install`          | 为当前 Windows 用户安装登录启动任务。                                   |
| `npm run startup:status`           | 查询登录启动任务状态。                                                  |
| `npm run startup:uninstall`        | 删除登录启动任务。                                                      |
| `npm run clean`                    | 删除构建产物、增量缓存和开发日志。                                      |

## 工程结构

```text
apps/server/       Fastify API、端点监听、模板解码与自动化执行
apps/web/          React WebUI 与本地化资源
packages/core/     跨端共享类型、配置 Schema 和规则匹配
packages/storage/  YAML 配置与 JSONL 日志存储
config/            本机运行配置与消息模板
doc/               架构、配置、开发和通信协议文档
scripts/           跨平台开发启动与清理脚本
tests/             仅通过构建入口和公开协议运行的独立验收与容器测试
```

更多信息：

- [架构说明](doc/architecture.md)
- [变更日志](CHANGELOG.md)
- [HTTP API](doc/api.md)
- [开发指南](doc/development.md)
- [自动化流程](doc/workflow_automation.md)
- [HTTP 通信规范](doc/http_communication_spec.md)
- [安全说明](SECURITY.md)
- [安全审计记录](doc/security-audit.md)
- [发布流程](doc/release.md)
- [部署说明](doc/deployment.md)
- [Docker 部署指南](doc/docker.md)
- [贡献指南](CONTRIBUTING.md)

## 项目状态

`v0.1.0` 是首次联合测试发行版。主分支已进入 S4 容器发布阶段。HTTP/WS 收发、持久 WS 客户端、消息模板、
QQ-AIC 基础消息兼容、消息与可靠时间触发器、参数化可视化工作流、可复用动作库、执行
队列、节点时间线和 WebUI 已经连通。鼠标控制、进程截图等更敏感的桌面控制能力不属于
本次发行范围，也不会作为默认功能开放。

## 许可证

本项目采用 [MIT License](LICENSE)。
