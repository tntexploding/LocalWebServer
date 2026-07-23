# 消息模板标准格式（v2.0）

本文定义 LocalWebServer 消息模板文件的标准结构。模板用于统一完成以下工作：

- 校验 HTTP 接收端收到的标准 JSON。
- 从有效 JSON 中提取日志展示字段。
- 为自动化流程提供稳定、可长期引用的匹配字段。
- 生成 HTTP 发送动作的最小请求体并应用默认值。
- 根据字段类型、枚举、范围和输入方式生成图形化表单。

模板文件必须是 UTF-8 编码的标准 JSON 文件，存放在 `config/templates`，扩展名必须为 `.json`。

## 1. 顶层结构

```json
{
  "templateVersion": "2.0",
  "id": "example-message",
  "name": "示例消息",
  "description": "模板用途说明。",
  "contentType": "application/json",
  "capabilities": {
    "receive": true,
    "send": true,
    "match": true
  },
  "schema": {},
  "minimum": {
    "body": {},
    "pruneEmpty": true
  },
  "fields": [],
  "constraints": [],
  "examples": [],
  "notes": []
}
```

| 属性              | 必需 | 说明                                         |
| ----------------- | ---- | -------------------------------------------- |
| `templateVersion` | 是   | 模板规范版本，当前固定为 `2.0`。             |
| `id`              | 是   | 稳定的机器标识。发布后不应随显示名称改变。   |
| `name`            | 是   | WebUI 中显示的模板名称。                     |
| `description`     | 是   | 模板覆盖的协议、方向和用途。                 |
| `contentType`     | 是   | 当前固定为 `application/json`。              |
| `capabilities`    | 是   | 声明模板能否接收校验、发送组包和规则匹配。   |
| `schema`          | 是   | 描述业务消息的 JSON Schema 2020-12。         |
| `minimum`         | 是   | 发送组包的最小结构和空值裁剪策略。           |
| `fields`          | 是   | 全部已知字段的统一元数据表，至少一项。       |
| `constraints`     | 是   | 跨字段约束；无约束时使用空数组。             |
| `examples`        | 是   | 完整、可通过 `schema` 校验的示例，至少一项。 |
| `notes`           | 是   | 鉴权、只读字段、路由优先级等重要补充说明。   |

服务启动或读取模板列表时会严格校验上述结构。字段 key/path 重复、示例不符合 Schema、默认值类型错误等情况会使模板加载失败，并给出模板文件与错误位置。

## 2. 标准 JSON Schema

`schema` 是消息格式的最终校验依据，使用 JSON Schema 2020-12。模板应在这里完整描述：

- 必需字段：`required`。
- JSON 类型：`type`。
- 固定值：`const`。
- 可填集合：`enum`。
- 字符串规则：`minLength`、`maxLength`、`pattern`、`format`。
- 数值规则：`minimum`、`maximum`、`exclusiveMinimum`、`exclusiveMaximum`。
- 数组规则：`items`、`minItems`、`maxItems`。
- 对象规则：`properties`、`additionalProperties`。
- 多种包体：`anyOf`、`oneOf`、`allOf` 和 `$defs`。

运行时支持的 `format` 包括：

- `date-time`
- `uri`
- `uuid`
- `email`
- `ipv4`
- `ipv6`

建议为协议型消息设置 `additionalProperties: false`，防止拼写错误悄悄进入消息；确实允许任意业务扩展的 `extra`、`payload` 等对象可单独设置 `additionalProperties: true` 或不限制属性。

## 3. 最小内容与默认值

```json
"minimum": {
  "body": {
    "type": "notice",
    "content": {}
  },
  "pruneEmpty": true
}
```

`minimum.body` 是发送动作开始组包时复制的基础 JSON。它应包含协议必须存在的对象层级，以及不依赖用户输入的协议默认值。

字段级默认值写在对应 `fields[].defaultValue` 中。发送组包顺序为：

1. 深拷贝 `minimum.body`。
2. 为声明了 `generatedValue` 的字段生成本次消息值，否则应用 `defaultValue`。
3. 应用用户填写的字段值。
4. 当 `pruneEmpty=true` 时，递归删除空字符串、`null`、空对象和空数组。
5. 检查必需字段和 `constraints`。
6. 使用完整 `schema` 校验最终 JSON。

如果空对象或空字符串本身是协议规定的有效必需值，应设置 `pruneEmpty=false`。

不要把示例业务数据放进 `minimum.body`。例如用户 ID、群号、目标 URL 和测试消息应只出现在 `examples`，否则用户未填写时可能误发示例值。

## 4. 字段定义

每个已知字段只定义一次。日志、发送表单和规则匹配都从同一字段定义派生。

```json
{
  "key": "priority",
  "label": "优先级",
  "path": "$.priority",
  "paths": ["$.metadata.priority"],
  "description": "消息优先级。",
  "required": false,
  "valueType": "integer",
  "defaultValue": 0,
  "allowedValues": [0, 1, 2],
  "minimum": 0,
  "maximum": 2,
  "roles": {
    "display": true,
    "send": true,
    "match": true
  },
  "input": {
    "control": "select",
    "placeholder": "0"
  }
}
```

### 4.1 标识与路径

| 属性           | 必需 | 说明                                                                         |
| -------------- | ---- | ---------------------------------------------------------------------------- |
| `key`          | 是   | 稳定字段标识，只能使用字母、数字和下划线，并以字母开头。规则永久引用该 key。 |
| `label`        | 是   | WebUI 展示名称。                                                             |
| `path`         | 是   | 主 JSONPath，必须以 `$.` 开头。发送时只写入主路径。                          |
| `paths`        | 否   | 接收解码时依次尝试的备用 JSONPath。                                          |
| `description`  | 是   | 字段用途、单位、方向和安全限制。                                             |
| `displayOrder` | 否   | 日志展示顺序，也用于兼容旧版数组下标规则。新模板通常无需设置。               |

`key` 一旦被规则使用就不应修改。移动业务 JSON 中的字段时，应保留 `key`，更新 `path`，并根据需要把旧路径放入 `paths`。

### 4.2 必需、类型和默认值

| 属性             | 必需 | 说明                                                                    |
| ---------------- | ---- | ----------------------------------------------------------------------- |
| `required`       | 是   | 发送组包完成后，该路径是否必须存在。是否允许空字符串仍由 Schema 决定。  |
| `valueType`      | 是   | `string`、`number`、`integer`、`boolean`、`object`、`array` 或 `null`。 |
| `defaultValue`   | 否   | 用户不填写时自动使用的值，必须符合本字段类型和范围。                    |
| `generatedValue` | 否   | 每次组包时生成 `uuid` 或 `utc-date-time`；可被用户显式填写值覆盖。      |
| `constValue`     | 否   | 唯一合法值。                                                            |
| `allowedValues`  | 否   | 全部允许值，用于校验并自动生成下拉框。                                  |

`generatedValue` 与 `defaultValue`、`constValue` 不能同时存在。`uuid` 只适用于 `valueType=string` 且 `format=uuid` 的字段；`utc-date-time` 只适用于 `valueType=string` 且 `format=date-time` 的字段。每次模板物化只生成一次值，因此一次动作执行中的请求正文保持稳定；发起另一次动作执行时会生成新值。

标识符（QQ 号、群号、雪花 ID、电话号码等）应使用 `string`，不要使用 `integer`，避免前导零丢失或超过 JavaScript 安全整数范围。

### 4.3 可填范围

| 属性                      | 适用类型       | 说明                                                  |
| ------------------------- | -------------- | ----------------------------------------------------- |
| `format`                  | string         | `date-time`、`uri`、`uuid`、`email`、`ipv4`、`ipv6`。 |
| `pattern`                 | string         | JavaScript 正则表达式字符串。                         |
| `minLength` / `maxLength` | string         | 字符数范围。                                          |
| `minimum` / `maximum`     | number/integer | 数值闭区间。                                          |
| `minItems` / `maxItems`   | array          | 数组元素数量范围。                                    |

字段元数据用于表单提示和发送前错误说明，`schema` 仍必须包含同等约束，确保接收消息也接受相同校验。

### 4.4 字段角色

```json
"roles": {
  "display": true,
  "send": false,
  "match": true
}
```

- `display`：解码成功后是否出现在端点日志摘要。
- `send`：是否允许 HTTP 发送动作填写并写入该字段。
- `match`：是否写入稳定解码值并允许自动化触发器选择。

只读输出字段（如响应状态、服务端时间戳）通常设置为 `send=false`、`match=true`。敏感字段（令牌、密码）原则上不应放入消息模板，而应使用端点请求头或安全配置。

### 4.5 输入控件

`input.control` 可选值：

- `text`
- `textarea`
- `number`
- `select`
- `checkbox`
- `json`

存在 `allowedValues` 或 `constValue` 时，WebUI 会优先使用下拉框。`object` 和 `array` 默认使用 JSON 文本框；`number` 和 `integer` 使用数值输入框。

## 5. 跨字段约束

当前支持 `atLeastOne`：指定路径中至少一个必须具有非空值。

```json
"constraints": [
  {
    "kind": "atLeastOne",
    "paths": ["$.content.text", "$.content.images"],
    "message": "文本与图片至少填写一项。"
  }
]
```

该约束主要用于向用户返回清楚的组包错误。相同规则仍应写进 JSON Schema 的 `anyOf`，以便接收校验与发送校验保持一致。

## 6. 示例与重要备注

`examples` 中每个 `body` 都必须通过 `schema`。至少提供一个最常见的完整示例；协议存在多种变体时，应分别提供最小请求、完整请求、成功响应和错误响应。

`notes` 用于记录无法只靠字段约束表达的重要行为，例如：

- Bearer Token 应放在 HTTP Header。
- 某字段只由服务端生成，客户端不应发送。
- 目标省略时进入路由匹配。
- URL、本地文件路径或命令执行的安全限制。
- 多个字段同时存在时的优先级。

## 7. 规则匹配

模板解码成功后，事件元数据包含：

```json
{
  "meta": {
    "decoded": {
      "template": "qq-aic-message-template.json",
      "templateId": "qq-aic-message",
      "matched": true,
      "values": {
        "content_text": "hello",
        "sender_id": "654321"
      }
    }
  }
}
```

规则使用稳定 key，而不是展示数组下标：

```json
{
  "jsonPath": "$.meta.decoded.values[\"content_text\"]",
  "equals": "hello"
}
```

模板名称条件仍使用：

```json
{
  "jsonPath": "$.meta.decoded.template",
  "equals": "qq-aic-message-template.json"
}
```

旧版 `$.meta.decoded.displayItems[n].value` 会暂时继续工作；在 WebUI 中打开并保存规则后会自动迁移到稳定 key。

## 8. 编写检查清单

提交模板前确认：

1. 文件是标准 JSON，没有注释、尾随逗号或 `NaN`。
2. `schema` 能拒绝错误类型、越界值和未知字段。
3. `minimum.body` 不包含可能被误发的示例 ID、地址或正文。
4. 每个字段都有唯一且稳定的 `key` 和 `path`。
5. 所有可选业务字段都在 `fields` 中声明类型与范围。
6. 字段元数据与 JSON Schema 的类型、枚举和范围一致。
7. 只读字段没有 `send` 角色，敏感字段没有进入模板。
8. 跨字段条件同时写入 `constraints` 和 JSON Schema。
9. 所有 `examples[].body` 都是实际有效消息。
10. `notes` 记录了鉴权、安全、优先级和方向限制。

完整可复制骨架见 `doc/template/message-template.v2.example.json`。
