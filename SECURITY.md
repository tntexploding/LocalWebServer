# 安全说明

## 使用范围

本项目按本地可信环境设计。不要直接把控制 API 或未鉴权的业务端点暴露到公网。需要跨主机访问时，应使用防火墙、可信内网或具备 TLS 和访问控制的反向代理。`allowedApiSources` 只保护 `/api/*` 控制面；业务端点是否可访问仍由端点监听地址、防火墙和上游鉴权决定。

## 必须检查的设置

- 运行 `npm run secrets:init`，不要把令牌明文保存在普通配置中。
- 将 `allowedApiSources` 限制为需要访问控制 API 的精确地址或 CIDR。
- 将 `corsOrigins` 限制为实际使用的 WebUI 来源，不使用通配浏览器来源。
- 跨主机读取日志时启用 `requireTokenForRead`。
- 保持 `allowShell: false`，除非动作确实需要 Shell 语法。
- 将 `allowedCommandRoots` 缩小到动作所需的具体目录。
- 检查 HTTP 客户端的目标 URL 和自定义请求头，避免令牌发送到错误主机。
- 仅启用实际使用的服务端和客户端。
- 不在消息模板、日志或版本库中保存密码、Cookie 和长期令牌。

本机 `config/*.yaml`、`config/templates/`、`doc/template/`、`.env*`、包管理器凭据、证书私钥和运行数据均由 `.gitignore` 排除。仓库只保存不含真实令牌和私有路径、且默认禁用的 `config/*.example.yaml`。`npm run audit:repo` 会在提交前再次检查该边界和常见凭据模式。

## 控制 API

控制 API 使用三个逐级授权角色：`readToken` 仅查询，`operatorToken` 可运行、发送、重放和取消，`apiToken` 可修改或恢复配置。所有角色均通过 `x-las-token` 发送。来源白名单先于令牌检查；浏览器还必须匹配 `corsOrigins`。`GET /api/health` 不要求令牌，但仍受来源白名单保护。

WebUI 输入的控制令牌只保存在 `sessionStorage`，关闭浏览器会话后即失效；升级时会把旧版本遗留在 `localStorage` 的令牌迁移到当前会话并立即删除持久副本。

被拒绝的请求和受保护的操作会写入 `data/security-audit.jsonl`，只记录时间、来源、方法、路径、角色、结果和状态码，不记录令牌或请求正文。

## 命令动作

外部消息不能直接提供命令，但可以触发 `config/actions.yaml` 中的预定义命令。命令参数仍应视为高风险配置：不要把未经校验的消息字段拼接进 Shell 字符串，也不要把允许目录设置为整个磁盘。

## 日志数据

`data/events.jsonl` 和 `data/runs.jsonl` 可能包含消息正文、远端地址和命令输出。持久化前会递归遮罩已知密钥值和名称中包含密码、令牌、Cookie、Authorization、API Key 或私钥的字段，HTTP 入站请求头和 Fastify 控制台日志也应用遮罩；无法识别的业务正文仍应视为敏感数据。该目录已从版本控制中排除，但仍应根据数据敏感度设置文件权限和保留周期。

便携包只包含构建产物、运行时、脱敏示例和说明文件，不复制实际配置、消息模板、协议样例、密钥、历史或日志。发布前仍应检查 `release/` 内容。

## 漏洞报告

发现安全问题时，请不要在包含真实令牌、消息或本机路径的公开 issue 中披露。应先向项目维护者私下提供复现步骤、影响范围和建议修复方式。
