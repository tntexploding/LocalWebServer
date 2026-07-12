# 架构说明

## 数据流

```text
HTTP/WS 端点
    |
    v
EndpointListenerManager
    |
    v
EventEnvelope -> JSONL 事件日志
    |
    v
EventProcessor -> 规则匹配
    |
    v
ActionQueue -> ActionExecutor -> command / HTTP / WS
    |
    v
JSONL 运行日志与 WebUI
```

所有入站消息会先转换为 `EventEnvelope`。自动行为只处理该标准事件，不直接依赖 Fastify 或 WebSocket 的原始请求对象，因此 HTTP 与 WS 可以共享规则和动作执行流程。

## 工作区职责

### `packages/core`

保存前后端共享的领域类型、Zod 配置 Schema、JSONPath 读取与规则匹配。该包不访问文件系统，也不启动网络监听。

### `packages/storage`

负责读取、校验和替换 YAML 配置，以及追加和查询 JSONL 日志。写入配置后会重新执行完整 Schema 校验。

### `apps/server`

- `index.ts`：组合依赖并注册控制 API。
- `endpointListenerManager.ts`：按 `host:port` 复用底层监听器，并按路径分发 HTTP/WS 消息。
- `messageTemplateDecoder.ts`：加载模板、校验 JSON、提取稳定字段和生成发送内容。
- `eventProcessor.ts`：持久化事件、匹配规则并提交动作。
- `actionQueue.ts`：限制并发、记录状态并支持取消。
- `actionExecutor.ts`：执行受控命令、HTTP 和 WS 动作。
- `endpointTester.ts`：提供不经过自动行为编辑器的端点连通性测试。

### `apps/web`

React 单页界面。界面只通过 `/api/*` 使用后端能力；中文和英文文案分别存储在 `src/locales`，业务组件不硬编码双语文案。

## 监听模型

具有相同 `host:port` 的 HTTP 和 WS 服务端共享一个 Node.js 监听器，再按路径区分端点。不同 IP 或端口会创建独立监听器。控制 API 自身使用 `config/app.yaml` 中的地址和端口。

## 配置更新

图形化编辑和原始 YAML 编辑最终都会进入 `ConfigStore`。端点配置应用失败时，后端会尝试恢复上一次监听状态；应用服务器地址变更需要重启主进程。

## 安全边界

控制 API 的写操作要求 `x-las-token`。命令动作只能在 `allowedCommandRoots` 中运行，Shell 默认关闭。该服务面向可信本机网络，不应在没有额外鉴权和反向代理保护的情况下暴露到公网。
