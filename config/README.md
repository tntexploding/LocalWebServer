# 本机配置

本目录中的实际 `*.yaml` 配置和 `templates/` 消息模板包含地址、令牌、文件路径、规则及业务协议，因此不会进入 Git。

首次克隆后，从脱敏示例创建本机配置：

```powershell
Copy-Item config/app.example.yaml config/app.yaml
Copy-Item config/endpoints.example.yaml config/endpoints.yaml
Copy-Item config/rules.example.yaml config/rules.yaml
Copy-Item config/actions.example.yaml config/actions.yaml
```

启动前至少应修改 `config/app.yaml` 中的 `security.apiToken` 和 `security.allowedCommandRoots`。

消息模板需要单独放入本机的 `config/templates/`。不要在模板中保存令牌、Cookie、密码、真实用户标识或不应公开的业务协议样例。
