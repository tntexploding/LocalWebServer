# HTTP API

控制 API 默认位于 `http://127.0.0.1:4789`。除读取接口外，写操作需要 `x-las-token` 请求头。

## 读取接口

| 方法与路径                  | 说明                          |
| --------------------------- | ----------------------------- |
| `GET /api/health`           | 主服务、WS 和端点监听器状态。 |
| `GET /api/config`           | 已校验并加载的全部配置。      |
| `GET /api/config/raw`       | 四个 YAML 文件的原始文本。    |
| `GET /api/templates`        | 已加载的消息模板摘要。        |
| `GET /api/events?limit=100` | 最近的标准事件。              |
| `GET /api/runs?limit=100`   | 最近的动作运行记录。          |
| `GET /api/queue`            | 等待和执行中的动作。          |

## 配置接口

| 方法与路径                  | 说明                                                 |
| --------------------------- | ---------------------------------------------------- |
| `PUT /api/endpoints`        | 校验、应用并保存全部端点。                           |
| `PUT /api/rules`            | 校验并保存规则数组。                                 |
| `PUT /api/actions`          | 校验并保存动作数组。                                 |
| `PUT /api/app/server`       | 保存控制服务地址；返回 `restartRequired`。           |
| `PUT /api/config/raw/:name` | 保存 `app`、`endpoints`、`rules` 或 `actions` YAML。 |

## 操作接口

| 方法与路径                    | 说明                              |
| ----------------------------- | --------------------------------- |
| `POST /api/endpoints/test`    | 测试指定 HTTP/WS 服务端或客户端。 |
| `POST /api/actions/:id/run`   | 手动执行一个已配置动作。          |
| `POST /api/rules/test`        | 测试事件匹配，不执行动作。        |
| `POST /api/events/:id/replay` | 复制历史事件并重新进入规则流程。  |
| `POST /api/queue/:id/cancel`  | 取消排队中或可取消的运行。        |
| `POST /api/ws/:target/send`   | 向 WS 端点 ID 或 URL 发送请求体。 |

## 示例

```powershell
$headers = @{ "x-las-token" = "<your-local-token>" }
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:4789/api/actions/say_hello/run `
  -Headers $headers
```

业务端点不位于 `/api` 下。它们由 `config/endpoints.yaml` 中的 `host`、`port` 和 `path` 决定。
