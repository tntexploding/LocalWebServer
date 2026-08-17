# 架构说明

## 数据流

```text
HTTP/WS 端点
    |
    v
EndpointListenerManager -> 共享监听器 / 持久 WS 客户端 / 自动重连
    |
    v
EventEnvelope -> JSONL 事件日志
    |
    v
EventProcessor -> 触发器匹配
    |
    v
WorkflowExecutor -> 上下文表达式 / 动作 / 逻辑分支 / 等待 / 结束点
    |
    +-> InteractionBroker -> WebUI 通知与选择框
    |
    v
ActionQueue -> ActionExecutor -> command / script / HTTP / WS / interaction / wait
    |
    v
可轮转 JSONL 运行日志 / 节点时间线 / WebUI

WorkflowScheduler -> 持久调度状态 / 时区 / 补执行 -> WorkflowExecutor
```

所有入站消息与时间触发都会转换为 `EventEnvelope`。自动化流程只处理该标准事件，
不直接依赖 Fastify、WebSocket 或计时器的原始对象，因此各类触发器共享同一执行流程。

## 工作区职责

### `packages/core`

保存前后端共享的领域类型、Zod 配置 Schema、安全工作流表达式、JSONPath 读取与规则匹配。该包不访问文件系统，也不启动网络监听。

### `packages/storage`

负责解析密钥引用，读取、迁移、校验和原子替换 YAML 配置，维护带 SHA-256 摘要的历史版本，原子替换调度状态，以及追加、轮转和查询 JSONL 日志。配置写入前会校验完整候选配置，失败时不接触原文件。

### `apps/server`

- `index.ts`：组合依赖并注册控制 API。
- `apiSecurity.ts`：执行来源、CORS、令牌角色和安全审计策略。
- `networkPolicy.ts`：统一执行入站来源/资源限制与外发地址、端口和负载策略。
- `runtimePolicy.ts`：在正式服务入口报告非阻断的 Node.js 版本建议。
- `endpointListenerManager.ts`：按 `host:port` 复用底层监听器，并按路径分发 HTTP/WS 消息。
- `messageTemplateDecoder.ts`：加载模板、校验 JSON、提取稳定字段和生成发送内容。
- `eventProcessor.ts`：持久化事件、匹配旧规则或工作流触发器。
- `workflowScheduler.ts`：计算并维护单次、间隔和每日时间触发计划，持久化上次触发时间。
- `workflowExecutor.ts`：遍历工作流、传递参数与节点结果，并记录实时节点时间线。
- `eventWaitBroker.ts`：为工作流和可复用等待动作分发后续事件。
- `interactionBroker.ts`：保存通知并协调阻塞式 WebUI 选择框。
- `actionQueue.ts`：限制并发、记录状态并支持取消。
- `actionExecutor.ts`：解析动作表达式，并执行受控命令、脚本、可靠发送、交互和等待动作。
- `endpointTester.ts`：提供不经过自动化流程的端点连通性测试。

### `apps/web`

React 单页界面。界面只通过 `/api/*` 使用后端能力；中文和英文文案分别存储在
`src/locales`，业务组件不硬编码双语文案。`WorkflowWorkspace.tsx` 负责自动化流程列表、
触发器和节点属性、拖拽画布与分支连接；动作页面维护独立可复用动作库。两者保存结果
分别直接对应 `rules.yaml` 和 `actions.yaml`。

## 监听模型

具有相同 `host:port` 的 HTTP 和 WS 服务端共享一个 Node.js 监听器，再按路径区分端点。不同 IP 或端口会创建独立监听器。控制 API 自身使用 `config/app.yaml` 中的地址和端口。

## 配置更新

图形化编辑和原始 YAML 编辑最终都会进入 `ConfigStore`。规则保存后会立即重建时间
计划，动作保存后会立即更新引用解析。端点配置应用失败时，后端会尝试恢复上一次监听
状态；应用服务器地址变更需要重启主进程。

每次候选配置都同时加载四份主文档，完成 Schema、重复 ID、端点路由、消息模板、动作
引用和流程可达性校验。通过后先保存旧内容的历史快照，再以同目录临时文件和重命名替换
目标文件。版本迁移与历史恢复走同一校验路径；历史内容摘要不匹配时拒绝恢复。

## 容器边界

容器镜像把只读程序目录 `/opt/las` 与可写运行根目录 `/var/lib/las` 分离。入口脚本仅在
数据卷为空时复制脱敏示例并初始化随机令牌，后端继续通过 `LAS_ROOT_DIR` 使用同一
`ConfigStore` 和日志实现。容器没有独立的测试开关或配置后门；镜像烟雾测试只从公开
HTTP 接口和 Docker 状态观察行为。

宿主机端口发布不属于端点配置：YAML 决定容器内监听，Compose 决定哪些端口可从容器外
访问。命令与脚本动作也只拥有容器用户权限及显式挂载目录，不继承宿主桌面能力。

## 安全边界

`/api/*` 控制面先检查来源白名单，再按只读、操作和管理角色检查 `x-las-token`，浏览器
请求还受精确 CORS 来源限制。业务监听和全部外发调用统一经过 `NetworkPolicy`。普通配置
使用 `${secret:name}` 或 `${env:NAME}` 引用密钥；返回配置、请求日志与审计记录不会暴露
解析后的令牌。命令动作只能使用绝对允许程序，并在真实路径位于允许根目录时以无 Shell、
最小环境运行。该服务面向可信本机网络，不应在没有 TLS、额外鉴权和防火墙保护的情况下
暴露到公网。

## 测试边界

包级测试位于各工作区的 `test/`，针对编译后的模块验证纯逻辑和组件行为。根目录
`tests/` 是独立验收工程：它创建临时运行目录、启动正式 `dist/index.js`，只通过配置文件、
HTTP、WebSocket 和生产 WebUI 观察结果，不导入服务器 `src`、不写入正式配置，也不要求
生产代码识别测试环境。测试夹具和 Playwright 依赖不会进入便携发行包。
