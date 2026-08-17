# Docker 部署指南

仓库支持本地构建，以及通过 GitHub Actions 向 GHCR 发布 `linux/amd64`、`linux/arm64`
多架构镜像。默认部署继续遵循本地优先、单用户和不直接暴露公网的安全模型。

## 快速启动

```sh
docker compose up --build -d
docker compose ps
docker compose logs -f las
```

健康后打开 `http://127.0.0.1:4789/ui/`。读取首次生成的角色令牌：

```sh
docker compose exec las cat /var/lib/las/config/secrets.yaml
```

令牌属于敏感信息，不应粘贴到 Issue、日志或 Compose 文件。停止服务使用
`docker compose down`；该命令保留命名数据卷。`docker compose down -v` 会同时永久删除
配置、密钥和日志，不应用于普通升级。

## 使用 GHCR 镜像

`main` 分支发布 `edge` 与 `sha-<提交摘要>`；稳定版本标签 `vX.Y.Z` 发布 `X.Y.Z`、
`X.Y`、`X`、`latest` 和提交摘要标签。预发行版本不会移动 `latest`。首次发布完成后，仓库
维护者应确认 GHCR 包已连接本仓库并设为公开；公开 Container Registry 包可以匿名拉取。

Compose 的镜像名支持 `LAS_IMAGE` 覆盖。本地构建仍使用默认值，已发布镜像使用：

```sh
export LAS_IMAGE=ghcr.io/tntexploding/localwebserver:edge
docker compose pull las
docker compose up --no-build -d
```

PowerShell 使用：

```powershell
$env:LAS_IMAGE = 'ghcr.io/tntexploding/localwebserver:edge'
docker compose pull las
docker compose up --no-build -d
```

生产部署应固定语义化版本或摘要，不使用会移动的 `edge`。升级前备份数据卷，拉取新镜像后
重新创建容器；回滚时恢复原镜像摘要，并在配置格式发生变化时恢复配套数据卷备份。

## 镜像结构

- 构建阶段安装完整锁定依赖并编译 TypeScript 与 WebUI。
- 生产依赖阶段只安装非开发依赖，最终镜像不包含源码、测试、真实配置或构建工具。
- 三个阶段使用 `release.config.json` 记录的官方 Node.js 24.18 Debian slim 多架构索引摘要；
  最终进程使用其中的 `node` 用户。
- `/opt/las` 是只读程序目录；`/var/lib/las` 是唯一持久可写运行根目录。
- `/tmp` 由 Compose 提供受限 tmpfs；容器移除全部 Linux capabilities，并启用
  `no-new-privileges`。
- 内置健康检查读取实际 `app.yaml` 端口并访问免令牌的 `/api/health`。

首次挂载空数据卷时，入口脚本会复制 `app.container.example.yaml`、端点、规则和动作示例，
随后调用现有密钥初始化器。复制使用“目标不存在才创建”的语义，因此重启或升级不会覆盖
WebUI 保存的配置。运行时仍可通过 `LAS_ROOT_DIR` 指向其他容器内目录。

## 网络边界

Compose 只发布：

```yaml
ports:
  - '127.0.0.1:4789:4789'
```

宿主机 IP 省略时，Docker 默认可能把端口发布到所有接口，因此不要随意改成
`4789:4789`。如确需局域网访问，应同时配置 TLS 反向代理、精确 CORS 来源、API 来源、
角色令牌和主机防火墙。

容器中的监听地址与宿主机发布地址是两层配置。启用额外 HTTP/WS 服务端时：

1. 在 `endpoints.yaml` 或 WebUI 中把该端点监听地址设为 `0.0.0.0`。
2. 在 `compose.yaml` 的 `ports` 中显式加入对应容器端口，例如
   `'127.0.0.1:7800:7800'`。
3. 根据真实调用方收紧 `network.inbound.allowedSources` 和业务端点鉴权。

Docker 无法根据运行中的 YAML 自动修改已创建容器的端口映射。未发布的端口即使在容器内
监听，也不能从宿主机直接访问。

HTTP/WS 客户端中的 `127.0.0.1` 指向容器自身，不再指向宿主机。连接同一 Compose 项目
中的服务时，可直接使用其服务名；连接宿主服务时，在 Linux Docker Engine 上还需为 LAS
服务启用：

```yaml
extra_hosts:
  - 'host.docker.internal:host-gateway'
```

Docker Desktop 通常已提供 `host.docker.internal`。无论名称来自 Compose DNS、Docker
Desktop 还是 `extra_hosts`，都必须在 `app.yaml` 中同时授权精确名称、预期解析地址和端口：

```yaml
network:
  outbound:
    allowedPrivateHostnames:
      - hostname: host.docker.internal
        allowedAddresses:
          - 172.16.0.0/12
    allowedPorts: [4789, 7800, 8765]
```

Compose 服务名采用相同配置方式，例如 `hostname: qq-bridge`，地址规则应收紧到该 Compose
网络的子网。运行时只有当 DNS 返回的每个地址都匹配该名称自己的地址白名单时，HTTP/WS
请求才会放行。目标端口仍必须独立列入 `allowedPorts`；不要把私网名称同时加入普通的
`allowedHostnames`。

## 配置与数据

命名卷 `las-state` 保存：

```text
/var/lib/las/config/    配置、消息模板和密钥
/var/lib/las/data/      事件、执行、审计、调度状态和配置历史
```

升级前应停止服务并备份整个卷。配置文件之间存在引用关系，不能只备份单个 YAML。恢复时应
把完整 `config/` 与 `data/` 放回同一运行根目录，并保持容器用户可读写。使用宿主机绑定
目录代替命名卷时，Linux 上必须确保 UID/GID 1000 具有写权限。

## 动作执行

命令和脚本动作在 Linux 容器中运行，不会直接控制宿主机进程、窗口或鼠标。Windows 路径
与可执行文件在镜像中不存在。若确需运行自有脚本，应显式挂载最小目录，并在
`security.allowedCommandRoots` 和 `allowedExecutables` 中使用容器内绝对路径。默认示例
保持两个白名单为空。

不要挂载 Docker socket，也不要启用 `privileged`。这两种做法会使自动化动作获得近似宿主
机管理权限，超出本项目当前安全模型。

## 验证

配置初始化的纯逻辑测试会随 `npm test` 运行。安装并启动 Docker 后，可执行完整独立烟雾
测试：

```sh
npm run test:container
npm run test:container:platforms
```

验证器使用随机镜像、容器、网络和数据卷名称，检查非 root 用户、健康状态、生产 WebUI、
重启后密钥持久化，以及通过 Docker DNS 和双重白名单向另一个容器真实发送 HTTP。结束后
只清理本次创建的资源。它不读取仓库中的本机配置，也不与主程序架构耦合。
多架构验证器使用随机命名的临时 `docker-container` Buildx builder，把两个平台的结果只写入
构建缓存，不登录或推送注册表；无论构建是否成功都会尝试移除该 builder。

发布流水线先获取完整 Git 历史并运行联网依赖漏洞/签名审计、完整 `npm run check` 和独立
容器烟雾测试，随后为 PR 构建但不推送两个目标平台；`main`、版本标签和手动运行才获得
GHCR 写权限。发布镜像包含 BuildKit SPDX SBOM、`mode=max` 来源证明、GitHub artifact
attestation 和 Sigstore 无密钥签名。外部 Actions 均固定到完整提交 SHA，并由 Dependabot
提议更新。

基础镜像同时使用可读标签和不可变索引摘要。升级 Node 容器版本时，应先核对官方多架构
索引包含两个目标平台，再同时修改 Dockerfile 与 `release.config.json`；仓库审计会拒绝两者
不一致。

验证 GitHub 来源证明：

```sh
gh attestation verify \
  oci://ghcr.io/tntexploding/localwebserver:edge \
  -R tntexploding/LocalWebServer
```

验证 Sigstore 签名：

```sh
cosign verify \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github.com/tntexploding/LocalWebServer/.github/workflows/container.yml@refs/(heads/.+|tags/v.*)$' \
  ghcr.io/tntexploding/localwebserver:edge
```

验证正式版本时，把最后的 `edge` 换成对应语义化标签或摘要。标签方便使用，摘要才是不可变
标识。

## 后续阶段

- 增加容器漏洞门禁、升级回滚和数据卷恢复演练。

Dockerfile 使用多阶段构建并以非 root 用户运行，Compose 的 `init`、`read_only`、
`cap_drop`、`security_opt` 与健康检查均遵循 Docker 官方文档：
[构建最佳实践](https://docs.docker.com/build/building/best-practices/)、
[多阶段构建](https://docs.docker.com/build/building/multi-stage/)、
[Compose 服务定义](https://docs.docker.com/reference/compose-file/services/) 和
[端口发布](https://docs.docker.com/reference/cli/docker/container/run/#publish-or-expose-port--p---expose)。
多架构、SBOM 和来源证明遵循
[Docker GitHub Actions](https://docs.docker.com/build/ci/github-actions/)、
[Docker attestations](https://docs.docker.com/build/ci/github-actions/attestations/) 与
[GitHub artifact attestations](https://docs.github.com/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)。
