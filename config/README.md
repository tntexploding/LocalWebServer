# 本机配置

本目录中的实际 `*.yaml` 配置和 `templates/` 消息模板包含地址、令牌、文件路径、规则及业务协议，因此不会进入 Git。

首次克隆后，从脱敏示例创建本机配置：

```powershell
Copy-Item config/app.example.yaml config/app.yaml
Copy-Item config/web.example.yaml config/web.yaml
Copy-Item config/endpoints.example.yaml config/endpoints.yaml
Copy-Item config/rules.example.yaml config/rules.yaml
Copy-Item config/actions.example.yaml config/actions.yaml
npm run secrets:init
```

`npm run secrets:init` 会创建 `config/secrets.yaml`，为管理、操作和只读角色生成随机令牌，
并将 `app.yaml` 中对应字段改为 `${secret:apiToken}` 一类引用。也可以使用
`${env:LAS_ADMIN_TOKEN}` 从环境变量读取值。密钥文件、环境变量和值本身都不会由配置
历史或 WebUI 原始配置接口返回。

旧版 `app.yaml` 若省略了过去由程序隐式补充的字段，请先执行
`npm run config:normalize`。该命令只从 `app.example.yaml` 复制缺失字段，不覆盖已有值；
随后再次执行 `npm run secrets:init`，为新增的密钥引用生成本机值。

启动前还应检查 `security.allowedApiSources`、`security.corsOrigins`、
`security.allowedCommandRoots` 和 `security.allowShell`。

`web.yaml` 只控制开发模式下 Vite 的监听地址、开发端口和预览端口。它不会由 WebUI
编辑，也不会进入配置历史；后端地址始终从 `app.yaml` 派生，避免在代码或前端中维护
第二份固定地址。

消息模板需要单独放入本机的 `config/templates/`。不要在模板中保存令牌、Cookie、密码、真实用户标识或不应公开的业务协议样例。

`rules.yaml` 的自动化流程格式见
[`doc/workflow_automation.md`](../doc/workflow_automation.md)。图形界面与 YAML 直接对应，
可使用 `rules.example.yaml` 作为脱敏起点。可复用动作存储在 `actions.yaml`，示例文件
覆盖命令、可靠 HTTP 发送、通知、选择框与等待消息。`data/` 中的事件日志、运行日志和
调度状态同样只属于本机运行数据，不应提交。

四份运行配置都使用顶层 `version: 1`。每次保存会先解析四份文件并校验端点、动作、模板
和流程引用，再通过同目录临时文件原子替换。旧版本位于 `data/config-history/`，可在
WebUI 顶栏的“配置历史”中恢复；恢复前仍会完整校验并为当前版本创建快照。
