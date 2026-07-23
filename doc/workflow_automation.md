# 自动化流程

“自动化”页面用于配置由端点消息或本地时间驱动的自动化流程。每个流程对应
`config/rules.yaml` 中的一个 `rules[]` 项；图形界面与 YAML 使用同一份数据，
不存在额外的浏览器私有流程格式。

## 使用流程

1. 新建或选择一个自动任务。
2. 在流程图中选择触发器，设置端点消息条件、单次时间、固定间隔或每日时间。
3. 添加动作、逻辑或结束点；动作节点引用“动作”页面中保存的可复用动作。
4. 选择源节点后点击“连接节点”，再点击目标节点建立分支。
5. 为动作分支选择“成功/失败”，为逻辑分支选择“成立/不成立”。
6. 确保每条可执行路径最终到达结束点，然后保存。

“配置文件”视图可以直接编辑完整 YAML。图形化保存也会立即重写该文件，
因此两种视图始终对应同一份配置。

## 顶层格式

```yaml
rules:
  - id: receive-and-reply
    enabled: true
    description: 接收模板消息，运行命令并按结果回复。
    workflow:
      version: '1.0'
      startNodeId: trigger
      nodes: []
      edges: []
```

| 字段          | 必填 | 说明                                       |
| ------------- | ---- | ------------------------------------------ |
| `id`          | 是   | 自动任务唯一 ID。                          |
| `enabled`     | 是   | 是否允许消息或时间触发流程。               |
| `description` | 否   | 面向用户的任务说明。                       |
| `workflow`    | 是   | 版本化流程图；新建任务固定使用版本 `1.0`。 |

旧版 `when`/`then` 规则仍可加载。首次在图形界面保存后，它会转换为工作流格式。

## 节点

所有节点都具有 `id`、`type`、`label` 和可选的画布坐标 `position`。`id` 在单个
工作流内必须唯一。

### 触发器

一个流程只有一个起始触发器，`startNodeId` 必须指向它。

```yaml
- id: trigger
  type: trigger
  label: 接收 QQ-AIC 消息
  position: {x: 40, y: 150}
  trigger:
    type: event
    event:
      source: http.server.qq-input
      kind: http.request
      template: qq-aic
      match:
        all:
          - jsonPath: '$.meta.decoded.values["messageType"]'
            equals: text
          - jsonPath: '$.meta.decoded.values["content"]'
            contains: hello
```

过滤字段如下：

| 字段        | 说明                                                               |
| ----------- | ------------------------------------------------------------------ |
| `source`    | 标准事件来源，例如 `http.server.qq-input`。                        |
| `anySource` | 为 `true` 时忽略来源；与 `source` 二选一。                         |
| `kind`      | `http.request`、`http.response`、`ws.message` 或 `action.result`。 |
| `template`  | 已成功解码的消息模板名称。                                         |
| `match`     | 一个或多个 JSONPath 条件；`all` 中的条件全部成立才会触发。         |

模板字段的稳定匹配路径为
`$.meta.decoded.values["<field-key>"]`。原始消息仍可通过 `$.body` 访问。

时间触发器可显式使用 IANA 时区，并为服务停止期间错过的执行选择跳过或恢复后补执行一次：

```yaml
# 单次执行
trigger:
  type: time
  schedule:
    mode: once
    at: '2026-08-01T09:30'
    misfirePolicy: runOnce

# 从保存后开始，每 60 秒执行一次；可用 startAt 指定首次时间
trigger:
  type: time
  schedule: {mode: interval, everyMs: 60000, misfirePolicy: skip}

# 每天执行
trigger:
  type: time
  schedule:
    mode: daily
    time: '09:30:00'
    timeZone: Asia/Shanghai
    misfirePolicy: runOnce
```

`once.at` 与 `interval.startAt` 必须是可解析日期时间，`everyMs` 至少为 1000；
`daily.time` 使用 `HH:mm` 或 `HH:mm:ss`，`timeZone` 使用 IANA 名称。未填写时区时使用
服务器本地时区。`misfirePolicy` 为 `skip` 或 `runOnce`。调度状态保存在
`storage.schedulerStatePath`，因此单次任务不会在重启后重复执行。

### 动作

新建动作节点只保存动作引用，复杂参数统一在“动作”页面或
`config/actions.yaml` 中维护：

```yaml
- id: reply
  type: action
  label: 发送回复
  action:
    type: reference
    actionId: send-qq-reply
    with:
      content: '${{ trigger.body.content }}'
      commandOutput: '${{ nodes.command.result.output ?? "" }}'
    onMissing: error
```

动作库支持命令、脚本、HTTP 发送、WebSocket 发送、WebUI 通知、选择框和等待消息。
字段与示例见 [配置指南](configuration.md#动作配置)。旧版工作流中的内联动作仍可
加载；在图形界面为该节点选择动作库条目后会转换为引用形式。

### 上下文与表达式

动作引用的 `with` 字段用于组装本次调用的输入。被引用动作的任意字符串字段可使用
`${{ ... }}`，解析发生在动作进入执行队列之后、实际执行之前。

| 根对象     | 内容                                                      |
| ---------- | --------------------------------------------------------- |
| `trigger`  | 启动流程的完整 `EventEnvelope`。                          |
| `inputs`   | 当前动作引用的 `with` 解析结果。                          |
| `nodes`    | 已执行节点，按节点 ID 提供 `status/result/event/output`。 |
| `last`     | 最近动作的 `result` 和最近等待到的 `event`。              |
| `workflow` | 当前流程的 `id/runId/traceId/startedAt`。                 |

```yaml
body:
  sender: '${{ trigger.body.sender.name ?? "unknown" }}'
  count: '${{ trigger.body.items[0].count }}'
  previous: '${{ nodes.prepare.result.output }}'
idempotencyKey: '${{ workflow.runId }}'
```

当整个字段只有一个表达式时，数字、布尔值、数组和对象会保留原类型；嵌入普通文字时会转换为
字符串。`??` 后必须是合法 JSON。路径只允许属性、非负数组索引和引号键，例如
`metadata["display-name"]`；不允许过滤器、通配符或脚本表达式。

`onMissing`（或动作的 `expressionPolicy`）支持：`error` 使动作失败，`empty` 填入空字符串，
`preserve` 保留原表达式文本。默认值是 `error`，适合尽早暴露配置错误。

### 逻辑

逻辑节点从上下文取值并选择“成立”或“不成立”分支。

```yaml
- id: command-result
  type: logic
  label: 检查命令输出
  logic:
    input: lastResult
    jsonPath: $.output
    operator: contains
    value: success
```

| `input`        | 内容                                 |
| -------------- | ------------------------------------ |
| `lastResult`   | 上一个动作的 `ActionResult`。        |
| `triggerEvent` | 最初触发该流程的 `EventEnvelope`。   |
| `lastEvent`    | 最近一个 `wait_event` 接收到的事件。 |

操作符包括 `success`、`equals`、`contains`、`regex` 和 `truthy`。其中
`success` 直接读取上一个动作的 `ok`；其他操作符可配合 `jsonPath` 提取值。

### 结束点

```yaml
- id: done
  type: end
  label: 完成
  end:
    status: completed
    message: 消息处理完成
```

`completed` 正常结束分支；`failed` 会以失败状态结束整个任务。每个工作流至少需要
一个结束点。

## 连接与分支

```yaml
edges:
  - {id: trigger-to-command, from: trigger, to: run-command, outcome: always}
  - {id: command-ok, from: run-command, to: command-result, outcome: success}
  - {id: command-error, from: run-command, to: failed, outcome: failure}
  - {id: result-true, from: command-result, to: reply, outcome: 'true'}
  - {id: result-false, from: command-result, to: failed, outcome: 'false'}
  - {id: reply-done, from: reply, to: done, outcome: success}
```

- 触发器只使用 `always`。
- 动作使用 `success`、`failure` 或 `always`。
- 逻辑使用 `true`、`false` 或 `always`。
- 同一结果可以连接多个目标，运行时会为每条边建立分支。
- 非结束节点必须至少有一条出边；所有实际执行路径应到达结束点。
- 循环流程允许保存，但单次执行最多经过 200 个节点。

## 运行、等待与取消

工作流本身显示在执行队列中，内部命令、HTTP 和 WebSocket 动作继续使用全局并发
队列。取消工作流会向当前子动作、消息等待和选择框传递取消信号。`wait_event` 只匹配
注册之后到达的事件，不查询历史日志。

每个动作节点和工作流整体都会写入 `data/runs.jsonl`。流程结果的 `detail.timeline` 保存
节点开始/结束时间、状态、分支结果、输入输出摘要和子动作运行 ID；`detail.nodeRunIds` 可关联
完整动作记录。运行中的同一结构会通过 `/api/queue` 实时提供，WebUI 会在流程图和日志链路中
高亮当前节点与已执行路径。

## 完整示例

可直接使用的脱敏示例位于
[`config/rules.example.yaml`](../config/rules.example.yaml)。端点 ID、工作目录、脚本和
目标地址必须根据本机配置修改。
