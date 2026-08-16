# HTTP 通信规范

本文档定义 `astrbot_plugin_interconnect` 与本地 HTTP 服务之间的 JSON 通信格式。

协议包含两个通信方向：

- 本地 HTTP 服务向插件发送消息，再由插件发送至 QQ。
- 插件接收 QQ 消息后，将消息推送至本地 HTTP Webhook。

当前标准协议版本为 `1.0`。HTTP 请求体统一使用 UTF-8 编码的
`application/json`。

## 1. 本地 HTTP 服务向 QQ 发送消息

### 1.1 接口

```http
GET http://127.0.0.1:8765/health
```

```http
POST http://127.0.0.1:8765/v1/messages
Content-Type: application/json
```

主机和端口由实际插件配置中的 `local.http.host` 和 `local.http.port`
决定。

如果配置了 `local.http.auth_token`，请求必须携带 Bearer Token：

```http
Authorization: Bearer <auth_token>
```

标准直发只使用 `target.id + target.conversation_type` 查找插件自动记录的 QQ 会话，
不依赖 `/interconnect bind` 或人工别名。目标会话应先发送一条能命中 QQ 到 HTTP
路由的消息，以便插件自动记录或刷新 AstrBot 发送地址。别名仅用于 README 所述的
最终人工兜底请求，不属于 LAS 的 QQ-AIC 标准发送表单。

### 1.2 最小文本请求

```json
{
  "target": {
    "id": "123456",
    "conversation_type": "qq_group"
  },
  "content": {
    "text": "来自本地 HTTP 服务的消息"
  }
}
```

### 1.3 最小图片请求

```json
{
  "target": {
    "id": "123456",
    "conversation_type": "qq_group"
  },
  "content": {
    "images": [
      {
        "url": "https://example.com/image.png"
      }
    ]
  }
}
```

`content.text` 和 `content.images` 至少有一项非空。文本和图片可以在同一
请求中同时发送。

### 1.4 完整可选字段模板

```json
{
  "message_id": "local-message-001",
  "source": {
    "type": "http_endpoint",
    "id": "local-app",
    "alias": "",
    "extra": {
      "endpoint_id": "alerts",
      "custom_source_field": "value"
    }
  },
  "target": {
    "type": "qq_session",
    "id": "123456",
    "conversation_type": "qq_group",
    "platform": "aiocqhttp",
    "alias": "",
    "extra": {}
  },
  "sender": {
    "id": "local-service-001",
    "name": "Local Service",
    "platform": "http",
    "group_id": "",
    "extra": {
      "department": "monitoring"
    }
  },
  "content": {
    "text": "服务告警",
    "images": [
      {
        "media_id": "image-001",
        "kind": "image",
        "source_type": "url",
        "url": "https://example.com/image.png",
        "file_path": "",
        "mime_type": "image/png",
        "sha256": "",
        "extra": {
          "description": "告警截图"
        }
      }
    ],
    "mentions": [],
    "extra": {
      "severity": "warning"
    }
  },
  "extra": {
    "trace_id": "trace-001"
  }
}
```

### 1.5 顶层字段

| 字段         | 必需     | 类型   | 默认值               | 作用与可填值                                      |
| ------------ | -------- | ------ | -------------------- | ------------------------------------------------- |
| `message_id` | 否       | string | 自动生成 UUID        | 客户端定义的消息唯一标识。                        |
| `source`     | 否       | object | `type=http_endpoint` | 描述本地消息来源，也用于 `local_to_qq` 路由匹配。 |
| `target`     | 条件必需 | object | `type=local`         | 直接发送时指定 QQ 会话；省略时使用路由。          |
| `sender`     | 否       | object | 空对象               | 业务发送者元数据，不改变 QQ 机器人的实际身份。    |
| `content`    | 是       | object | 无                   | 消息正文；`text` 和 `images` 至少一项非空。       |
| `extra`      | 否       | object | `{}`                 | 消息级自定义扩展字段。                            |

客户端即使提供以下字段，当前入站解析也不会使用它们：

- `schema_version`
- `direction`
- `route_id`
- `timestamp`
- `raw_refs`

因此，本地服务向插件发送消息时不建议包含这些只读或输出字段。

### 1.6 `source` 字段

| 字段    | 必需 | 类型   | 默认值          | 说明                                                 |
| ------- | ---- | ------ | --------------- | ---------------------------------------------------- |
| `type`  | 否   | string | `http_endpoint` | 来源类型。推荐使用 `http_endpoint`，路由会匹配该值。 |
| `id`    | 否   | string | `""`            | 本地应用或服务 ID。                                  |
| `alias` | 否   | string | `""`            | 本地来源别名。                                       |
| `extra` | 否   | object | `{}`            | 来源扩展字段。                                       |

当路由配置使用 `source.endpoint_id` 时，请求中的 `endpoint_id` 必须放入
`source.extra`：

```json
{
  "source": {
    "type": "http_endpoint",
    "extra": {
      "endpoint_id": "alerts"
    }
  },
  "content": {
    "text": "CPU 使用率超过 90%"
  }
}
```

### 1.7 `target` 字段

| 字段                | 必需         | 类型   | 默认值       | 说明                                           |
| ------------------- | ------------ | ------ | ------------ | ---------------------------------------------- |
| `type`              | 否           | string | `qq_session` | 当前直发类型；旧值 `qq_session_alias` 仍兼容。 |
| `id`                | 标准直发必需 | string | `""`         | 群号、QQ 号或平台 OpenID。                     |
| `conversation_type` | 标准直发必需 | string | `""`         | `qq_group` 或 `qq_private`。                   |
| `source_type`       | 否           | string | `""`         | `conversation_type` 的兼容名称。               |
| `platform`          | 否           | string | `""`         | 多适配器存在相同 ID 时用于消歧。               |
| `alias`             | 兜底         | string | `""`         | `/interconnect bind` 创建的备用会话别名。      |
| `extra`             | 否           | object | `{}`         | 兼容扩展信息。                                 |

LAS 的 QQ-AIC 标准发送固定填写 `id + conversation_type`，并且不会生成
`alias`。plugin_ic 自身仍兼容 alias-only 的最后兜底请求，但应在确认会话地址无法
自动记录后手工使用，不应写入正常端点或自动化动作。

省略 `target` 或传入空对象时，消息不会直接指定 QQ 会话，而是进入
`local_to_qq` 路由匹配。

### 1.8 `sender` 字段

| 字段       | 必需 | 类型   | 默认值 | 说明                                       |
| ---------- | ---- | ------ | ------ | ------------------------------------------ |
| `id`       | 否   | string | `""`   | 业务发送者 ID。                            |
| `name`     | 否   | string | `""`   | 业务发送者名称。                           |
| `platform` | 否   | string | `""`   | 来源平台名称，推荐填写 `http` 或应用名称。 |
| `group_id` | 否   | string | `""`   | 业务侧群组 ID，不决定实际 QQ 发送目标。    |
| `extra`    | 否   | object | `{}`   | 发送者扩展字段。                           |

这些字段用于业务追踪和协议扩展，不会改变 QQ 机器人在平台上的实际发送
身份。

### 1.9 `content` 字段

| 字段          | 必需     | 类型     | 默认值 | 说明                                                 |
| ------------- | -------- | -------- | ------ | ---------------------------------------------------- |
| `text`        | 条件必需 | string   | `""`   | 发送至 QQ 的文本。                                   |
| `images`      | 条件必需 | object[] | `[]`   | 要发送的图片列表。                                   |
| `videos`      | 接收只读 | object[] | `[]`   | QQ 到 Webhook 标准化的视频列表。                     |
| `files`       | 接收只读 | object[] | `[]`   | QQ 到 Webhook 标准化的文件列表。                     |
| `attachments` | 接收只读 | object[] | `[]`   | 音频等通用媒体附件。                                 |
| `links`       | 接收只读 | object[] | `[]`   | Share 组件或 JSON 卡片提取出的链接内容。             |
| `forwards`    | 接收只读 | object[] | `[]`   | 已尝试展开的 QQ 合并转发消息。                       |
| `mentions`    | 否       | string[] | `[]`   | QQ 号列表；当前 HTTP 到 QQ 方向尚不会生成 `@` 组件。 |
| `extra`       | 否       | object   | `{}`   | 内容级自定义字段。                                   |

HTTP 到 QQ 方向目前只实现文本与图片发送。其余媒体、链接与转发字段用于接收
QQbot 的标准 Webhook，不会出现在发送表单中。

### 1.10 图片字段

| 字段          | 必需     | 类型   | 默认值        | 说明                                                            |
| ------------- | -------- | ------ | ------------- | --------------------------------------------------------------- |
| `media_id`    | 否       | string | 自动生成 UUID | 图片业务标识。                                                  |
| `kind`        | 否       | string | `image`       | 媒体种类；当前仅实现图片发送。                                  |
| `source_type` | 否       | string | `unknown`     | 建议填写 `url` 或 `file`，实际读取依据为 `url` 和 `file_path`。 |
| `url`         | 条件必需 | string | `""`          | 使用 HTTP 或 HTTPS 的图片地址。                                 |
| `file_path`   | 条件必需 | string | `""`          | 插件媒体数据目录内的本地文件路径。                              |
| `mime_type`   | 否       | string | `""`          | MIME 元数据，例如 `image/png`。远程下载以 HTTP 响应为准。       |
| `sha256`      | 否       | string | `""`          | 预留的摘要字段；当前不会依据它校验请求。                        |
| `extra`       | 否       | object | `{}`          | 图片自定义元数据。                                              |

`url` 与 `file_path` 至少提供一个；两者同时存在时优先使用 `url`。

图片安全规则：

- 图片 URL 必须使用 `http` 或 `https`。
- 下载过程受 MIME 类型、超时时间和最大字节数配置限制。
- 本地文件只能位于插件数据媒体目录中。
- 媒体缓存位于 AstrBot 的 `data/plugin_data/astrbot_plugin_interconnect/media/`
  目录，不写入插件代码目录。
- 单张图片失败不会阻止其他有效图片和文本继续发送。
- 如果消息只有图片且所有图片均被拒绝，则整个目标发送失败。

## 2. 本地消息路由至 QQ

本地请求省略 `target` 时，可以通过配置中的 `local_to_qq` route 选择一个
或多个 QQ 目标。

请求示例：

```json
{
  "source": {
    "type": "http_endpoint",
    "id": "monitoring-service",
    "extra": {
      "endpoint_id": "alerts"
    }
  },
  "content": {
    "text": "CPU 使用率超过 90%"
  }
}
```

当前调度顺序如下：

1. 请求包含非空 `target` 时，直接发送到该 QQ 会话。
2. 请求省略 `target` 时，匹配启用的 `local_to_qq` 路由。
3. 路由没有命中时返回投递失败。

因此测试发送应优先填写明确目标；路由只用于调用方无法在请求中携带目标的情况。

## 3. 插件 HTTP 响应

### 3.1 成功响应

```json
{
  "ok": true,
  "message_id": "local-message-001",
  "results": [
    {
      "target": {
        "type": "qq_session",
        "id": "123456",
        "alias": "",
        "extra": {"source_type": "qq_group"}
      },
      "ok": true,
      "message": "sent"
    }
  ]
}
```

### 3.2 目标投递失败

```json
{
  "ok": false,
  "message_id": "local-message-001",
  "results": [
    {
      "target": {
        "type": "qq_session",
        "id": "123456",
        "alias": "",
        "extra": {"source_type": "qq_group"}
      },
      "ok": false,
      "message": "QQ session '123456' has not been recorded."
    }
  ]
}
```

### 3.3 请求格式错误

```json
{
  "ok": false,
  "error": {
    "code": "invalid_request",
    "message": "content.text or content.images is required."
  }
}
```

### 3.4 HTTP 状态码

| 状态码 | 含义                                     |
| ------ | ---------------------------------------- |
| `200`  | 所有目标均发送成功。                     |
| `400`  | JSON 无效或请求字段不符合要求。          |
| `401`  | Bearer Token 缺失或无效。                |
| `413`  | 请求体超过 `local.http.max_body_bytes`。 |
| `502`  | 请求有效，但至少一个目标投递失败。       |
| `500`  | 插件内部处理异常。                       |

`results` 中每个元素对应一次目标投递。多路由或多目标请求可能返回多个
结果。顶层 `ok` 只有在所有结果的 `ok` 均为 `true` 时才为 `true`。

## 4. QQ 消息推送至本地 HTTP Webhook

QQ 入站是否转发只由 plugin_ic 的 `routes` 决定，不以
`/interconnect bind <alias>` 为前置条件。命中入站路由后，插件会自动记录该会话的
AstrBot 发送地址，供后续按 `target.id + target.conversation_type` 反向发送。

插件按照 route 中的 Webhook URL 发出请求：

```http
POST http://127.0.0.1:9000/webhook
Content-Type: application/json
```

### 4.1 标准 Webhook 包体

```json
{
  "schema_version": "1.0",
  "event_type": "message",
  "message_type": "text",
  "message_id": "qq-message-id",
  "direction": "qq_to_local",
  "route_id": "main_group_to_webhook",
  "source": {
    "type": "qq_group",
    "id": "123456",
    "alias": "main_group",
    "extra": {
      "group_id": "123456",
      "user_id": "654321",
      "platform": "aiocqhttp",
      "session_alias": "main_group"
    }
  },
  "target": {
    "type": "http_webhook",
    "id": "local-service",
    "alias": "",
    "extra": {
      "url": "http://127.0.0.1:9000/webhook",
      "timeout_seconds": 8,
      "retry_attempts": 2,
      "retry_backoff_seconds": 0.5
    }
  },
  "sender": {
    "id": "654321",
    "name": "Alice",
    "platform": "aiocqhttp",
    "group_id": "123456",
    "extra": {}
  },
  "content": {
    "text": "来自 QQ 的消息",
    "images": [],
    "videos": [],
    "files": [],
    "attachments": [],
    "links": [],
    "forwards": [],
    "mentions": [],
    "extra": {}
  },
  "raw_refs": {
    "astrbot_message_id": "qq-message-id",
    "unified_msg_origin": "platform-specific-origin",
    "raw_message_id": "qq-message-id",
    "extra": {}
  },
  "timestamp": "2026-07-12T08:00:00+00:00",
  "extra": {}
}
```

### 4.2 Webhook 顶层字段

| 字段             | 类型   | 说明                                         |
| ---------------- | ------ | -------------------------------------------- |
| `schema_version` | string | 协议版本，默认 `1.0`。                       |
| `event_type`     | string | 事件类型，当前固定为 `message`。             |
| `message_type`   | string | 正文类型，见下方消息类型表。                 |
| `message_id`     | string | QQ/AstrBot 消息 ID；无法获取时生成 UUID。    |
| `direction`      | string | 固定为 `qq_to_local`。                       |
| `route_id`       | string | 实际匹配并执行的 route ID。                  |
| `source`         | object | QQ 群聊或私聊来源。                          |
| `target`         | object | 当前 Webhook 投递目标。                      |
| `sender`         | object | QQ 消息发送者。                              |
| `content`        | object | 标准化正文、媒体、链接、转发和提及对象。     |
| `raw_refs`       | object | AstrBot 和平台原始消息引用，可通过配置省略。 |
| `timestamp`      | string | UTC ISO 8601 时间戳。                        |
| `extra`          | object | 消息级扩展字段，可通过配置省略。             |

### 4.3 `source` 可填值

| 字段                  | 可能值                   | 说明                                   |
| --------------------- | ------------------------ | -------------------------------------- |
| `type`                | `qq_group`、`qq_private` | 根据消息是否来自 QQ 群自动确定。       |
| `id`                  | 群号或 QQ 号             | 群消息使用群号，私聊使用发送者 QQ 号。 |
| `alias`               | 自动或人工备用名称       | 可能由插件自动记录；不是路由前置条件。 |
| `extra.group_id`      | 群号或空字符串           | 私聊通常为空。                         |
| `extra.user_id`       | QQ 号                    | 消息发送者 QQ 号。                     |
| `extra.platform`      | AstrBot 平台名           | 例如 `aiocqhttp`。                     |
| `extra.session_alias` | 插件记录的备用名称       | 与 `source.alias` 一致；直发无需填写。 |

### 4.4 消息类型与媒体对象

`event_type` 是协议事件类别，目前固定为 `message`；`message_type` 才表示
正文类型，可取 `text`、`image`、`video`、`file`、`audio`、`forward`、
`link`、`mixed` 或 `unknown`。消息同时包含多类正文时使用 `mixed`。

QQ 图片、视频和文件分别写入 `content.images`、`content.videos` 和
`content.files`。三者使用同一 `MediaRef` 结构：

```json
{
  "media_id": "qq-message-id-image-0",
  "kind": "image",
  "source_type": "file",
  "url": "",
  "file_path": "C:/AstrBot/data/plugin_data/astrbot_plugin_interconnect/media/sha256.png",
  "name": "image.png",
  "mime_type": "image/png",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "size_bytes": 2048,
  "extra": {
    "cached": true,
    "original_url": "https://temporary.qq-cdn.example/image.png"
  }
}
```

`kind` 对应 `image`、`video` 或 `file`；`source_type` 可能为 `url`、
`file`、`base64` 或 `unknown`。文件名称优先来自 QQ 组件的 `name`，否则由
URL 或文件路径推导。视频封面等非通用信息保存在 `extra`。

接收插件会在投递 Webhook 前尝试把图片、视频、文件和音频立即写入受容量与
过期时间限制的插件缓存。缓存成功时，`file_path` 是稳定本地引用，`sha256`
和 `size_bytes` 描述实际内容，临时 URL 仅保存在 `extra.original_url` 供排错；
缓存失败时保留原始引用并在 `extra.cache_error` 中说明原因。远程下载只允许
公共 HTTP(S) 地址，并受 MIME、超时、单文件大小和总缓存容量限制。

旧版适配器曾将视频与文件降级为空 `content`；LAS 仍把这类历史包体识别为
有效兼容消息，但无法恢复源端当时没有发送的内容。

### 4.5 链接与合并转发

`content.links` 保存 Share 组件和 JSON 卡片中提取出的 `kind`、`url`、
`title`、`summary`、`image_url`，并在 `payload` 中保留经过深度、数量和长度
限制的结构化卡片。`content.forwards` 保存 `forward_id`，并通过 QQ API 尝试
展开 `nodes`；每个节点包含 `sender_id`、`sender_name`、`time`、`text` 和
受限的原始 `segments`。展开失败不会丢弃转发 ID，具体原因会写入插件日志。

### 4.6 Webhook 接收方响应要求

本地 Webhook 收到消息后应返回任意 `2xx` 状态码。插件只检查 HTTP 状态
码，不解析响应正文。

- `2xx`：投递成功。
- `429`：投递失败，可根据配置重试。
- `5xx`：投递失败，可根据配置重试。
- 其他 `4xx`：视为请求或配置错误，默认不重试。
- 超时或网络错误：可根据配置重试。

## 5. Webhook route 配置

```json
{
  "id": "main_group_to_webhook",
  "enabled": true,
  "direction": "qq_to_local",
  "source": {
    "type": "qq_group",
    "id": "123456"
  },
  "targets": [
    {
      "type": "http_webhook",
      "id": "local-service",
      "url": "http://127.0.0.1:9000/webhook",
      "timeout_seconds": 8,
      "retry_attempts": 2,
      "retry_backoff_seconds": 0.5,
      "auth_token": "",
      "headers": {}
    }
  ]
}
```

| 字段                    | 必需     | 可填值与说明                                      |
| ----------------------- | -------- | ------------------------------------------------- |
| `url`                   | 是       | 有效的 HTTP 或 HTTPS Webhook 地址。               |
| `timeout_seconds`       | 否       | 正数，默认 `8` 秒。                               |
| `retry_attempts`        | 否       | `0` 至 `5`，表示首次失败后的额外重试次数。        |
| `retry_backoff_seconds` | 否       | 正数，最大 `30` 秒；采用指数退避。                |
| `auth_token`            | 否       | 自动生成 `Authorization: Bearer <token>` 请求头。 |
| `headers`               | 否       | 自定义 HTTP 请求头对象。                          |
| `payload_mode`          | 否       | `standard` 或 `template`。                        |
| `payload_template`      | 条件必需 | `template` 模式下使用的 JSON 对象或 JSON 字符串。 |
| `schema_version`        | 否       | 覆盖该目标发送的协议版本。                        |
| `include_raw_refs`      | 否       | 是否包含 `raw_refs`。                             |
| `include_extra`         | 否       | 是否包含顶层 `extra`。                            |

`auth_token` 和 `headers` 属于敏感传输配置，不会被放入标准 Webhook JSON
包体的 `target.extra` 中。

## 6. 自定义 Webhook JSON 模板

全局协议配置：

```json
{
  "protocol": {
    "schema_version": "1.0",
    "webhook_payload_mode": "standard",
    "webhook_payload_template": "",
    "include_raw_refs": true,
    "include_extra": true
  }
}
```

将 `webhook_payload_mode` 设置为 `template` 后，可以使用完整 JSON 模板：

```json
{
  "event": "qq_message",
  "version": "${schema_version}",
  "message_type": "${message_type}",
  "id": "${message_id}",
  "text": "${content.text}",
  "sender": {
    "id": "${sender.id}",
    "name": "${sender.name}"
  },
  "images": "${content.images}",
  "videos": "${content.videos}",
  "files": "${content.files}",
  "links": "${content.links}",
  "forwards": "${content.forwards}",
  "original": "${envelope}"
}
```

常用占位符：

```text
${schema_version}
${event_type}
${message_type}
${message_id}
${direction}
${route_id}
${timestamp}
${source}
${target}
${sender.id}
${sender.name}
${sender.platform}
${sender.group_id}
${content.text}
${content.images}
${content.videos}
${content.files}
${content.attachments}
${content.links}
${content.forwards}
${content.mentions}
${raw_refs}
${envelope}
```

模板规则：

- 字符串完全等于一个占位符时，保留原始 JSON 类型。例如
  `"${content.images}"` 会生成数组，而不是字符串。
- 占位符嵌入普通文本时，结果转换为字符串。
- `${envelope}` 表示完整标准包体。
- 使用不存在的占位符会使该 Webhook 投递失败，但不会导致 AstrBot 主流程
  崩溃。

单个 `http_webhook` target 可以使用 `payload_mode`、`payload_template`、
`include_raw_refs` 和 `include_extra` 覆盖全局协议配置。

## 7. 配置与参考文件

实际运行配置通常位于：

```text
AstrBot/data/config/astrbot_plugin_interconnect_config.json
```

`_conf_schema.json` 仅定义 WebUI 配置结构、字段说明和默认值。修改实际配置
后，应在 AstrBot WebUI 中重载插件。

本项目中保存的协议参考模板：

```text
doc/template/http_to_qq.standard.json
doc/template/qq_to_http_webhook.standard.json
doc/template/interconnect_http_standard_formats.json
```
