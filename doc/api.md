# HTTP API

控制 API 默认位于 `http://127.0.0.1:4789`。所有 `/api/*` 请求必须来自
`security.allowedApiSources`；浏览器来源还必须精确匹配 `security.corsOrigins`。

| 角色 | 配置字段        | 权限                                             |
| ---- | --------------- | ------------------------------------------------ |
| 只读 | `readToken`     | 配置摘要、模板、事件、运行、队列和交互查询。     |
| 操作 | `operatorToken` | 包含只读权限，并可测试、运行、发送、重放和取消。 |
| 管理 | `apiToken`      | 包含全部权限，并可读取原始配置、保存和恢复历史。 |

令牌通过 `x-las-token` 请求头发送。`requireTokenForRead: false` 时，只读接口允许白名单
来源免令牌访问；操作和管理接口始终需要对应令牌。`GET /api/health` 始终免令牌，但不绕过
来源白名单。

## 读取接口

| 方法与路径                    | 说明                                    |
| ----------------------------- | --------------------------------------- |
| `GET /api/health`             | 主服务、WS 和端点监听器状态。           |
| `GET /api/config`             | 已校验并加载的全部配置。                |
| `GET /api/templates`          | 已加载的消息模板摘要。                  |
| `GET /api/events?limit=100`   | 可筛选的最近标准事件。                  |
| `GET /api/runs?limit=100`     | 可筛选的动作与流程运行记录。            |
| `GET /api/workflows/:id/runs` | 指定自动流程的最近整体运行记录。        |
| `GET /api/queue`              | 等待/执行中的动作及下一次时间触发计划。 |
| `GET /api/interactions`       | 待显示的通知和待处理选择框。            |

## 配置接口

| 方法与路径                                   | 说明                                                      |
| -------------------------------------------- | --------------------------------------------------------- |
| `GET /api/config/raw`                        | 读取四个 YAML 文件的原始文本。                            |
| `GET /api/config/history?name=...`           | 列出全部或指定文档的本机历史版本。                        |
| `PUT /api/endpoints`                         | 校验、应用并保存全部端点。                                |
| `PUT /api/rules`                             | 校验并保存规则数组。                                      |
| `PUT /api/actions`                           | 校验并保存动作数组。                                      |
| `PUT /api/app/server`                        | 保存控制服务地址；返回 `restartRequired`。                |
| `PUT /api/config/raw/:name`                  | 保存 `app`、`endpoints`、`rules` 或 `actions` YAML。      |
| `POST /api/config/history/:name/:id/restore` | 校验并恢复历史版本；恢复 `app` 时返回 `restartRequired`。 |

本节接口均要求管理令牌。保存前会同时验证四份配置的 Schema、重复 ID、引用、模板和流程
可达性；失败返回 `400` 及结构化问题，不改变磁盘文件。成功保存和恢复都会先备份当前内容。

## 操作接口

| 方法与路径                           | 说明                                         |
| ------------------------------------ | -------------------------------------------- |
| `POST /api/endpoints/test`           | 测试指定 HTTP/WS 服务端或客户端。            |
| `POST /api/actions/:id/run`          | 手动执行一个已配置动作。                     |
| `POST /api/rules/test`               | 测试事件匹配，不执行动作。                   |
| `POST /api/events/:id/replay`        | 复制历史事件并重新进入规则流程。             |
| `POST /api/queue/:id/cancel`         | 取消排队中或可取消的运行。                   |
| `POST /api/ws/:target/send`          | 向 WS 端点 ID 或 URL 发送请求体。            |
| `POST /api/interactions/:id/respond` | 提交选择框结果，请求体为 `{"value":"..."}`。 |
| `DELETE /api/interactions/:id`       | 关闭通知或取消等待中的选择框。               |

`POST /api/queue/:id/cancel` 同时支持普通动作运行 ID 和工作流运行 ID。取消工作流会继续取消其当前子动作、事件等待或选择框。

`GET /api/queue` 的 `schedules[]` 包含 `ruleId`、`mode` 与 ISO 格式的
`nextRunAt`，并可包含 `lastRunAt` 和 `timeZone`。运行中的流程记录包含实时
`detail.currentNodeIds` 与 `detail.timeline`。

日志查询参数：

- `/api/events`：`limit`、`source`、`kind`、`traceId`。
- `/api/runs`：`limit`、`actionId`、`ruleId`、`traceId`、`workflowRunId`、`status`。
- `/api/workflows/:id/runs`：`limit`。

`limit` 范围为 1 至 1000。查询会跨当前文件与轮转日志，从新到旧返回匹配记录。

受保护操作的允许、失败与拒绝结果写入 `storage.auditLogPath`。审计项不包含令牌或正文。

## 示例

```powershell
$headers = @{ "x-las-token" = "<your-local-token>" }
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:4789/api/actions/say_hello/run `
  -Headers $headers
```

业务端点不位于 `/api` 下。它们由 `config/endpoints.yaml` 中的 `host`、`port` 和 `path` 决定。
