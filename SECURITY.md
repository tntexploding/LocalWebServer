# 安全说明

## 支持范围

| 版本   | 安全更新 |
| ------ | -------- |
| 0.1.x  | 支持     |
| <0.1.0 | 不支持   |

## 安全模型

本项目是本地优先的自动化网关，不是可直接暴露到公网的多租户服务。默认信任边界是当前
运行账户（Windows 用户或容器 `node` 用户）和显式加入白名单的本机/局域网地址。控制
API、业务 HTTP/WS 端点、外发目标、配置文件、消息内容以及本地命令分别经过独立限制。

程序自身不终止 TLS。跨主机传输令牌、消息或日志时，必须使用可信 VPN，或在前方部署
具备 TLS、访问控制和请求限制的反向代理；同时仍应保留程序内的来源白名单。不要把控制
API 或未鉴权的业务端点直接暴露到公网。

## 启动前检查

- 推荐使用 Node.js 24.18.1 或更新的 24.x。源码启动仅提示版本偏差；便携包仍固定使用
  `release.config.json` 指定并校验的版本。
- 运行 `npm run secrets:init`，让普通配置仅保存 `${secret:name}` 或 `${env:NAME}` 引用；
  该命令也会迁移端点请求头等敏感字段中的本机内联值。
- 三个控制令牌至少 32 字符且互不相同；不要继续使用 `replace-*` 一类示例值。
- 将 `security.allowedApiSources` 与 `network.inbound.allowedSources` 缩小到精确 IP、CIDR 或 `loopback`。
- 将 `security.corsOrigins` 与 `network.inbound.allowedOrigins` 限制为实际浏览器来源，不使用通配来源。
- 只允许确切的外发主机、IP/CIDR 和端口。默认配置只允许回环地址及列出的本机端口。
- `security.allowShell` 必须保持 `false`；命令使用绝对可执行文件路径和最小工作目录白名单。
- 仅启用正在使用的端点、动作和自动化流程，并使用主机防火墙限制监听端口。

## 控制 API

`/api/*` 先检查来源地址和浏览器 Origin，再按角色验证 `x-las-token`：`readToken` 只读，
`operatorToken` 可执行、发送、重放和取消，`apiToken` 可修改与恢复配置。`GET /api/health`
无需令牌，但仍受来源与 Origin 策略保护。令牌比较采用固定长度摘要和时序安全比较。

WebUI 仅把令牌保存在 `sessionStorage`。旧版本留在 `localStorage` 的令牌会迁移到当前会话
并删除持久副本。控制 API 的 500 响应不返回内部异常原文；拒绝和受保护操作写入
`data/security-audit.jsonl`，但不记录令牌或正文。

## HTTP 与 WebSocket

业务端点统一执行来源和 Origin 白名单、正文/消息大小限制、请求/请求头超时、最大请求头
数量和 WS 连接数限制。外发 HTTP/WS 只接受显式允许的协议、精确主机或地址及端口，拒绝
URL 内嵌用户名/密码；HTTP 不自动跟随重定向，请求与响应均有大小上限。目标 URL 写入日志
前会删除凭据、查询值和片段。

允许公共 DNS 主机时，程序会先解析并拒绝指向回环、私网、链路本地、保留或组播地址的
结果。但底层 HTTP/WS 客户端仍会再次解析域名，因此不能把域名白名单当作抵御恶意 DNS
重绑定的绝对边界。高安全本地链路应使用固定 IP/CIDR、可信 DNS 或出口防火墙。

Docker 服务名、宿主网关名称和可信私网 DNS 名称只能通过
`network.outbound.allowedPrivateHostnames` 授权。每项必须同时指定精确小写主机名和该名称
允许解析到的地址/CIDR，且 DNS 返回的全部地址都必须匹配；目标端口还要单独进入
`allowedPorts`。不要为了容器互联把私网名称放入普通 `allowedHostnames`，也不要使用超出
实际 Docker 网络或宿主网关范围的地址规则。

## 本地动作

外部消息只能触发已经保存的动作，不能直接指定命令、解释器、脚本或工作目录。命令与
脚本字段禁止工作流表达式；可执行文件必须是绝对路径并位于 `allowedExecutables`，工作
目录和脚本经过 `realpath` 后必须位于 `allowedCommandRoots`。子进程始终使用
`shell: false`，只继承 `commandEnvironmentAllowlist` 中的环境变量，且输出、超时和并发
均受限制。

预先授权的命令本身仍拥有当前 Windows 用户的权限。不要允许整个磁盘、通用 Shell 或可被
低权限用户修改的脚本目录；不要把未经验证的消息内容作为命令参数。需要更强隔离时，应把
服务运行在专用低权限账户、容器或虚拟机中。

## 配置、密钥与日志

实际 `config/*.yaml`、`config/templates/`、`doc/template/`、`.env*`、包管理器凭据、证书
私钥、`data/` 与 `release/` 均被 Git 忽略。原始配置保存会拒绝敏感字段中的明文，以及
敏感 URL 查询参数中的明文；结构化保存会把已知值重新保护为引用。配置与状态写入使用
同目录临时文件和原子重命名，配置历史带 SHA-256 完整性摘要，受管路径不得逃出运行根目录。

事件和运行日志可能包含业务正文、远端地址与命令输出。已知密钥值、敏感字段名和认证请求
头会被遮罩，但无法识别的业务数据仍应视为敏感信息。请使用合适的 NTFS 权限，并按
`maxLogBytes`、`maxLogFiles` 和组织策略控制保留周期。

## Docker

默认 Compose 仅把控制端口发布到宿主机 `127.0.0.1`，并使用非 root 用户、只读根文件
系统、移除全部 Linux capabilities 和 `no-new-privileges`。不要把端口简写为
`4789:4789` 后仍假定它只对本机开放；不要启用 `privileged`，也不要挂载 Docker socket。
后两项会使允许的自动化动作获得接近宿主机管理权限。

`/var/lib/las` 数据卷包含实际配置、令牌、消息模板、日志和历史，必须按敏感数据备份和
保护。`docker compose down -v` 会删除该卷。容器内 `127.0.0.1` 指向容器自身，额外监听
端口必须显式发布，命令动作也只能访问镜像和显式挂载目录。完整说明见
[Docker 部署指南](doc/docker.md)。

## 依赖与发布

`npm run audit:lock` 离线验证生产依赖来自官方 npm HTTPS 注册表、具有 SHA-512 完整性、
使用允许的许可证且不带生产安装脚本。`npm run audit:dependencies` 执行 npm 漏洞查询与
签名/来源证明验证。`npm run audit:repo` 扫描当前候选文件、Git 历史路径和补丁中的常见
凭据模式；模式扫描降低误提交风险，但不能证明不存在所有秘密。

便携包从 Node.js 官方地址下载固定运行时并核对 SHA-256，使用
`npm ci --omit=dev --ignore-scripts` 安装锁定依赖，随后执行生产依赖审计和签名验证。发行物
包含 CycloneDX SBOM、逐文件 `MANIFEST.sha256`、发布元数据和压缩包外部 SHA-256，不包含
实际配置、消息模板、私有协议样例、密钥、日志或测试工程。详见 [发布流程](doc/release.md)。

容器发布的 PR 作业只有源码读取权限；GHCR 写入、OIDC 和证明权限只存在于通过质量门禁的
发布作业。所有外部 Actions 固定到完整提交 SHA。镜像按摘要附带 BuildKit SBOM、最大级别
provenance、GitHub artifact attestation 和 Sigstore 无密钥签名。构建参数不得承载密钥，
因为最大级别来源证明可能公开构建参数值；敏感构建输入必须使用 BuildKit secret mount，
当前 Dockerfile 不需要任何敏感构建输入。Node 基础镜像固定到经过双架构检查的 OCI 索引
摘要，并由发行配置与仓库审计共同约束。

## 漏洞报告

发现安全问题时，请不要在包含真实令牌、消息或本机路径的公开 issue 中披露。应先向项目
维护者提交 [GitHub 私密安全报告](https://github.com/tntexploding/LocalWebServer/security/advisories/new)，
并提供复现步骤、影响范围、受影响版本和建议修复方式。若该入口暂不可用，请先通过维护者
GitHub 主页建立私密联系，不要创建包含敏感信息的公开讨论。
