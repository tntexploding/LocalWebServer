# Local Automation Server

Local Automation Server 是一个本地 HTTP/WebSocket 网关与自动化服务。它负责管理收发端点、将消息标准化为事件、按声明式规则匹配事件，并通过受控队列执行命令、HTTP 发送和 WebSocket 发送动作。

## 功能概览

- 为不同 IP、端口和路径创建 HTTP/WS 服务端。
- 通过完整 URL 创建 HTTP/WS 客户端。
- 使用 YAML 管理端点、自动行为、动作和运行设置。
- 使用 JSON 消息模板校验接收内容、提取字段和生成发送表单。
- 按来源、事件类型、JSONPath、等值、包含或正则条件触发动作链。
- 记录事件、执行历史与队列状态，并通过中文/英文 WebUI 管理。
- 限制命令工作目录、Shell 使用方式和动作并发数。

## 环境要求

- Node.js 20.19 或更高版本，推荐使用当前 LTS 版本。
- npm 10 或更高版本。
- Windows、macOS 或 Linux；命令动作本身可能依赖操作系统。

## 快速开始

```powershell
npm install
Copy-Item config/app.example.yaml config/app.yaml
Copy-Item config/endpoints.example.yaml config/endpoints.yaml
Copy-Item config/rules.example.yaml config/rules.yaml
Copy-Item config/actions.example.yaml config/actions.yaml
npm run dev
```

已有本机配置时无需覆盖。实际配置和消息模板已被 Git 忽略，详细说明见 [本机配置说明](config/README.md)。

开发模式会同时启动后端和前端：

- WebUI：`http://127.0.0.1:5277`
- 后端 API：`http://127.0.0.1:4789`

如需分别排查，可使用 `npm run dev:server` 和 `npm run dev:web`。

生产式本地运行会先构建全部工作区，再由后端托管 WebUI：

```powershell
npm start
```

随后打开 `http://127.0.0.1:4789/ui/`。

## 基本使用

1. 在“端点”页面创建 HTTP/WS 服务端或客户端。
2. 为 HTTP 端点选择消息模板，或直接使用原始 JSON。
3. 在“自动行为”页面定义消息来源、匹配条件和动作顺序。
4. 在“定时任务/动作”页面配置并测试可执行动作。
5. 在“日志”页面查看接收、发送、匹配和执行结果。

默认写操作令牌位于 `config/app.yaml`。调用写 API 时使用请求头：

```http
x-las-token: <your-local-token>
```

请在真实环境中立即替换默认令牌。

## 配置文件

| 文件                      | 用途                                                  |
| ------------------------- | ----------------------------------------------------- |
| `config/app.yaml`         | 本机 API 监听、安全边界、并发和日志路径，不进入 Git。 |
| `config/endpoints.yaml`   | 本机 HTTP/WS 服务端与客户端，不进入 Git。             |
| `config/rules.yaml`       | 本机事件匹配条件和动作链，不进入 Git。                |
| `config/actions.yaml`     | 本机命令、HTTP 和 WS 动作，不进入 Git。               |
| `config/templates/*.json` | 本机消息协议与字段定义，不进入 Git。                  |
| `config/*.example.yaml`   | 可以提交的脱敏初始化示例。                            |

实际配置不会在格式化或清理命令中被重置。详细说明见 [配置指南](doc/configuration.md) 和 [消息模板标准](doc/message_template_standard.md)。

## 常用命令

| 命令                | 作用                                    |
| ------------------- | --------------------------------------- |
| `npm run dev`       | 同时启动后端和 Vite WebUI。             |
| `npm start`         | 构建并启动后端托管版本。                |
| `npm run check`     | 检查格式、风格、类型并执行生产构建。    |
| `npm run format`    | 使用 GTS 与 Prettier 格式化源码和文档。 |
| `npm run lint`      | 执行 Google TypeScript 风格检查。       |
| `npm run typecheck` | 检查所有 npm 工作区的 TypeScript 类型。 |
| `npm run clean`     | 删除构建产物、增量缓存和开发日志。      |

## 工程结构

```text
apps/server/       Fastify API、端点监听、模板解码与自动化执行
apps/web/          React WebUI 与本地化资源
packages/core/     跨端共享类型、配置 Schema 和规则匹配
packages/storage/  YAML 配置与 JSONL 日志存储
config/            本机运行配置与消息模板
doc/               架构、配置、开发和通信协议文档
scripts/           跨平台开发启动与清理脚本
```

更多信息：

- [架构说明](doc/architecture.md)
- [HTTP API](doc/api.md)
- [开发指南](doc/development.md)
- [HTTP 通信规范](doc/http_communication_spec.md)
- [安全说明](SECURITY.md)

## 项目状态

项目仍处于本地优先的开发阶段。HTTP/WS 收发、消息模板、规则匹配、动作队列和 WebUI 已经连通；更敏感的桌面控制能力尚未作为默认功能开放。
