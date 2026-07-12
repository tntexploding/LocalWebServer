# 配置指南

实际配置文件包含本机地址、令牌、路径和自动化规则，因此不会进入 Git。首次克隆时应从 `config/*.example.yaml` 创建对应的 `config/*.yaml`，再填写本机值。消息模板同样只保存在本机 `config/templates/`。

## 应用配置

`config/app.yaml` 包含四组设置：

- `server`：控制 API 的 `host`、`port` 和兼容 WS 路径。
- `security`：写令牌、命令允许目录和 Shell 开关。
- `automation`：最大并发动作数。
- `storage`：事件和动作运行日志路径。

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

## 自动行为

规则将标准事件映射到动作链：

```yaml
rules:
  - id: hello-command
    enabled: true
    when:
      source: http.server.inbound
      kind: http.request
      match:
        jsonPath: $.body.command
        equals: hello
    then:
      - action: say_hello
```

模板成功解码后，可通过稳定字段键匹配：

```yaml
match:
  jsonPath: '$.meta.decoded.values["content_text"]'
  equals: hello
```

## 动作配置

支持三类动作：

- `command`：在受允许的工作目录执行固定命令和参数。
- `send_http`：向完整 URL 发送 HTTP 请求，可使用消息模板。
- `send_ws`：向 WS 服务端 ID、WS 客户端 ID 或直接 URL 发送 JSON。

外部消息只能触发已经保存的动作，不能直接指定任意命令。

## 消息模板

模板位于 `config/templates`，使用 UTF-8 JSON。完整格式、最小内容、字段角色、取值范围和跨字段约束见 [消息模板标准](message_template_standard.md)。QQ 插件通信字段见 [HTTP 通信规范](http_communication_spec.md)。
