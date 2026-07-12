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
POST http://127.0.0.1:8765/v1/messages
Content-Type: application/json
```

主机和端口由实际插件配置中的 `local.http.host` 和 `local.http.port`
决定。

如果配置了 `local.http.auth_token`，请求必须携带 Bearer Token：

```http
Authorization: Bearer <auth_token>
```

目标 QQ 会话必须提前在对应群聊或私聊中绑定：

```text
/interconnect bind main_group
```

### 1.2 最小文本请求

```json
{
  "target": {
    "alias": "main_group"
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
    "alias": "main_group"
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
    "type": "qq_session_alias",
    "id": "",
    "alias": "main_group",
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

| 字段    | 必需     | 类型   | 默认值             | 说明                                     |
| ------- | -------- | ------ | ------------------ | ---------------------------------------- |
| `type`  | 否       | string | `qq_session_alias` | 当前已实现的 QQ 目标类型。               |
| `alias` | 条件必需 | string | `""`               | 由 `/interconnect bind` 创建的会话别名。 |
| `id`    | 条件必需 | string | `""`               | 可以代替 `alias` 保存会话别名。          |
| `extra` | 否       | object | `{}`               | 目标扩展信息；当前 QQ 发送端不使用。     |

当 `type` 为 `qq_session_alias` 时，`alias` 与 `id` 至少提供一个。若两者
同时存在，插件优先使用 `alias`。

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

| 字段       | 必需     | 类型     | 默认值 | 说明                                                 |
| ---------- | -------- | -------- | ------ | ---------------------------------------------------- |
| `text`     | 条件必需 | string   | `""`   | 发送至 QQ 的文本。                                   |
| `images`   | 条件必需 | object[] | `[]`   | 要发送的图片列表。                                   |
| `mentions` | 否       | string[] | `[]`   | QQ 号列表；当前 HTTP 到 QQ 方向尚不会生成 `@` 组件。 |
| `extra`    | 否       | object   | `{}`   | 内容级自定义字段。                                   |

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

对应 route 配置：

```json
{
  "id": "alerts_to_main_group",
  "enabled": true,
  "direction": "local_to_qq",
  "source": {
    "type": "http_endpoint",
    "endpoint_id": "alerts"
  },
  "targets": [
    {
      "type": "qq_session_alias",
      "alias": "main_group"
    }
  ]
}
```

当前调度顺序如下：

1. 插件首先匹配所有启用的 `local_to_qq` 路由。
2. 如果存在匹配路由，消息发送至路由定义的全部目标。
3. 如果不存在匹配路由，且请求提供了非 `local` 类型的 `target`，插件直接
   使用该目标发送。
4. 如果没有匹配路由，也没有直接目标，请求返回投递失败。

因此，即使请求包含 `target`，只要它同时匹配某条 `local_to_qq` 路由，当前
实现仍会优先使用路由目标。

## 3. 插件 HTTP 响应

### 3.1 成功响应

```json
{
  "ok": true,
  "message_id": "local-message-001",
  "results": [
    {
      "target": {
        "type": "qq_session_alias",
        "id": "",
        "alias": "main_group",
        "extra": {}
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
        "type": "qq_session_alias",
        "id": "",
        "alias": "unknown_group",
        "extra": {}
      },
      "ok": false,
      "message": "QQ session alias 'unknown_group' is not bound."
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

只有通过 `/interconnect bind <alias>` 显式绑定的 QQ 群聊或私聊会话，才
允许进入 QQ 到本地的路由和 Webhook 投递流程。

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
| `message_id`     | string | QQ/AstrBot 消息 ID；无法获取时生成 UUID。    |
| `direction`      | string | 固定为 `qq_to_local`。                       |
| `route_id`       | string | 实际匹配并执行的 route ID。                  |
| `source`         | object | QQ 群聊或私聊来源。                          |
| `target`         | object | 当前 Webhook 投递目标。                      |
| `sender`         | object | QQ 消息发送者。                              |
| `content`        | object | 标准化文本、图片和提及对象。                 |
| `raw_refs`       | object | AstrBot 和平台原始消息引用，可通过配置省略。 |
| `timestamp`      | string | UTC ISO 8601 时间戳。                        |
| `extra`          | object | 消息级扩展字段，可通过配置省略。             |

### 4.3 `source` 可填值

| 字段                  | 可能值                   | 说明                                     |
| --------------------- | ------------------------ | ---------------------------------------- |
| `type`                | `qq_group`、`qq_private` | 根据消息是否来自 QQ 群自动确定。         |
| `id`                  | 群号或 QQ 号             | 群消息使用群号，私聊使用发送者 QQ 号。   |
| `alias`               | 已绑定会话别名           | 由 `/interconnect bind` 的绑定记录注入。 |
| `extra.group_id`      | 群号或空字符串           | 私聊通常为空。                           |
| `extra.user_id`       | QQ 号                    | 消息发送者 QQ 号。                       |
| `extra.platform`      | AstrBot 平台名           | 例如 `aiocqhttp`。                       |
| `extra.session_alias` | 已绑定会话别名           | 与 `source.alias` 一致。                 |

### 4.4 `content.images` 图片对象

QQ 图片会转换为与 HTTP 入站图片相同的 `MediaRef` 结构：

```json
{
  "media_id": "qq-message-id-image-0",
  "kind": "image",
  "source_type": "url",
  "url": "https://example.com/image.png",
  "file_path": "",
  "mime_type": "image/png",
  "sha256": "",
  "extra": {}
}
```

其中 `source_type` 可能为 `url`、`file` 或 `unknown`。插件在 QQ 到 Webhook
方向仅标准化引用，不会为了生成标准包体而强制下载图片。

### 4.5 Webhook 接收方响应要求

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
    "type": "*",
    "alias": "main_group"
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
  "id": "${message_id}",
  "text": "${content.text}",
  "sender": {
    "id": "${sender.id}",
    "name": "${sender.name}"
  },
  "images": "${content.images}",
  "original": "${envelope}"
}
```

常用占位符：

```text
${schema_version}
${event_type}
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
