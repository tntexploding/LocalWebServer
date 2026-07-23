# 配置指南

实际配置文件包含本机地址、令牌、路径和自动化规则，因此不会进入 Git。首次克隆时应从 `config/*.example.yaml` 创建对应的 `config/*.yaml`，再填写本机值。消息模板同样只保存在本机 `config/templates/`。仓库级审查命令 `npm run audit:repo` 会拒绝已跟踪的实际配置、模板、凭据和本机运行产物。

四份主配置都使用顶层 `version: 1`。缺少版本的旧配置会在完整校验后迁移为当前版本；
高于当前版本的文件会被拒绝，避免旧程序误写新格式。

开发 WebUI 另从 `config/web.yaml` 读取 Vite 的 `host`、`port` 和 `previewPort`。
该文件不属于后端运行配置，也不会由 WebUI 保存；`npm run dev` 和 `npm run dev:web`
都会读取它。前端 API 地址由 `app.yaml` 的 `server.host`、`server.port` 派生，生产构建
则使用后端托管的同源地址。

旧版 `app.yaml` 可能省略曾由 Schema 隐式补充的字段。升级时运行
`npm run config:normalize`，程序会以 `app.example.yaml` 为唯一补全来源，只增加缺失项而
不覆盖现有配置；随后运行 `npm run secrets:init` 补齐对应的本机密钥。运行时 Schema
本身不再携带地址、端口、目录或日志路径的默认实例值。

## 应用配置

`config/app.yaml` 包含四组必须显式填写的设置：

- `server`：控制 API 的 `host`、`port` 和兼容 WS 路径。
- `security`：角色令牌引用、API 来源、CORS、命令允许目录和 Shell 开关。
- `automation`：最大并发动作数。
- `storage`：事件/运行/审计日志、调度状态、配置历史和日志轮转设置。

推荐先执行 `npm run secrets:init`。普通配置只保存引用：

```yaml
security:
  apiToken: '${secret:apiToken}'
  operatorToken: '${secret:operatorToken}'
  readToken: '${secret:readToken}'
  requireTokenForRead: true
  allowedApiSources: ['127.0.0.1', '::1']
  corsOrigins: ['http://127.0.0.1:5277']
```

`${secret:name}` 从忽略版本控制的 `config/secrets.yaml` 读取，`${env:NAME}` 从进程环境
读取。缺失引用会阻止启动或保存；结构化保存会把已知密钥值重新保护为引用。

```yaml
storage:
  eventLogPath: data/events.jsonl
  runLogPath: data/runs.jsonl
  auditLogPath: data/security-audit.jsonl
  schedulerStatePath: data/scheduler-state.json
  configHistoryPath: data/config-history
  configHistoryLimit: 30
  maxLogBytes: 10485760
  maxLogFiles: 5
```

日志达到 `maxLogBytes` 后轮转为 `.1`、`.2` 等文件；读取 API 会按新到旧跨文件查询。
`schedulerStatePath` 用于避免单次任务在重启后重复执行，并为间隔/每日任务判断是否需要补执行。

## 保存、校验与恢复

WebUI 图形编辑和原始 YAML 编辑使用相同保存流程：先在内存中加载四份候选配置，完成
Schema 校验、重复 ID/路由检查、动作/端点/模板引用检查以及工作流可达性检查；然后为
旧文件建立历史快照，最后通过同目录临时文件重命名完成原子替换。任何解析、校验、监听
应用或写入失败都不会先清空原文件。

历史保存在 `configHistoryPath/<文档>/<版本 ID>/`，包括原内容、时间、原因、大小和
SHA-256。恢复时会验证摘要和完整候选配置，并先备份当前版本。可通过 WebUI 顶栏或
[配置历史 API](api.md#配置接口) 恢复；`configHistoryLimit` 按每份文档保留最近版本。

修改控制 API 的监听地址后必须重启进程。修改并发数、规则和动作后，WebUI 保存成功即可生效。

## 端点配置

`config/endpoints.yaml` 包含 `httpServers`、`wsServers`、`httpClients` 和 `wsClients`。

HTTP 服务端示例：

```yaml
httpServers:
  - id: inbound
    enabled: true
    host: 127.0.0.1
    port: 7800
    path: /messages
    template: qq-aic-message-template.json
```

HTTP 客户端使用完整基础 URL，并可选择发送模板：

```yaml
httpClients:
  - id: qq-plugin
    enabled: true
    baseUrl: http://127.0.0.1:8765
    template: qq-aic-message-template.json
    templateFields:
      - $.target.alias
      - $.content.text
    templateValues:
      $.target.alias: main_group
      $.content.text: hello
```

`templateFields` 决定界面显式编辑的字段；模板会从 `minimum.body` 和字段默认值补齐必填内容，并按模板设置裁剪空值。

WS 客户端是长期连接；保存端点后会主动连接，并可配置指数退避重连和 ping/pong 心跳：

```yaml
wsClients:
  - id: upstream
    enabled: true
    url: ws://127.0.0.1:8765/ws
    reconnect:
      enabled: true
      initialDelayMs: 1000
      maxDelayMs: 30000
      backoffMultiplier: 2
    heartbeatIntervalMs: 30000
```

从该连接收到的消息来源为 `ws.client.upstream`；向动作目标 `upstream` 发送时会复用同一连接。

## 自动化流程

自动化使用版本化流程图，将端点消息或本地时间映射到动作与逻辑分支：

```yaml
rules:
  - id: hello-workflow
    enabled: true
    workflow:
      version: '1.0'
      startNodeId: trigger
      nodes:
        - id: trigger
          type: trigger
          label: Receive hello
          trigger:
            type: event
            event:
              source: http.server.inbound
              kind: http.request
              match:
                all:
                  - jsonPath: $.body.command
                    equals: hello
        - id: run
          type: action
          label: Run action
          action:
            type: reference
            actionId: say_hello
            with:
              message: '${{ trigger.body.command }}'
            onMissing: error
        - id: done
          type: end
          label: Complete
          end: {status: completed}
      edges:
        - {id: trigger-run, from: trigger, to: run, outcome: always}
        - {id: run-done, from: run, to: done, outcome: success}
```

模板成功解码后，可通过稳定字段键匹配：

```yaml
match:
  all:
    - jsonPath: '$.meta.decoded.values["content_text"]'
      equals: hello
```

时间触发器支持 `once`、`interval` 和 `daily` 三种计划。节点类型、分支结果与完整
结构见 [自动化流程](workflow_automation.md)。旧版 `when`/`then` 与旧版消息触发器
仍可读取，并可由图形界面转换。

`with` 会先在当前流程上下文中解析，再作为被引用动作的 `inputs`。动作字段可使用
`${{ trigger.body.command }}`、`${{ inputs.message }}`、
`${{ nodes.run.result.output }}`、`${{ last.event.body }}` 和
`${{ workflow.runId }}`。缺失值可用 JSON 回退值，例如
`${{ trigger.body.name ?? "unknown" }}`；完整规则见
[自动化流程](workflow_automation.md#上下文与表达式)。

## 动作配置

`config/actions.yaml` 是独立动作库，支持七类可复用动作：

- `command`：在受允许的工作目录执行固定命令和参数。
- `script`：通过显式解释器执行脚本文件。
- `send_http`：向完整 URL 发送 HTTP 请求，可使用消息模板。
- `send_ws`：向 WS 服务端 ID、WS 客户端 ID 或直接 URL 发送 JSON。
- `notification`：向本地 WebUI 发布非阻塞通知。
- `prompt`：在 WebUI 显示选项并阻塞当前流程，直到选择、超时或取消。
- `wait_event`：按来源、事件类型、模板和 JSONPath 条件等待后续消息。

外部消息只能触发已经保存的动作，不能直接指定任意命令。

工作流动作节点只需使用 `{type: reference, actionId: <动作 ID>}`。命令与脚本仍经过
相同的允许目录、Shell 与超时安全检查。脱敏示例见
[`config/actions.example.yaml`](../config/actions.example.yaml)。

HTTP/WS 发送动作支持超时和指数退避重试。HTTP 仅重试网络错误、超时、`408`、`425`、
`429` 与 `5xx`；其他 `4xx` 不重试。`maxAttempts` 包含首次请求：

```yaml
- id: reliable-send
  type: send_http
  method: POST
  url: http://127.0.0.1:7800/messages
  body: {message: '${{ inputs.message }}'}
  timeoutMs: 5000
  idempotencyKey: '${{ workflow.runId }}'
  retry:
    maxAttempts: 3
    initialDelayMs: 500
    backoffMultiplier: 2
    maxDelayMs: 5000
```

## 消息模板

模板位于 `config/templates`，使用 UTF-8 JSON。完整格式、最小内容、字段角色、取值范围和跨字段约束见 [消息模板标准](message_template_standard.md)。QQ 插件通信字段见 [HTTP 通信规范](http_communication_spec.md)。
