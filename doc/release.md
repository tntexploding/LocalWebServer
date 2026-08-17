# 发布流程

## 发布前条件

1. 工作树内容已经过审阅，实际配置、模板、令牌、日志和私有协议文件未被跟踪。
2. `release.config.json` 记录推荐的源码版本，并为便携包固定 Node.js 24.x 官方归档 SHA-256。
3. 锁文件只包含预期的注册表来源和依赖版本。
4. 在联网环境执行完整检查：

```powershell
npm run audit:dependencies
npm run check
```

`audit:dependencies` 需要访问 npm 注册表；`check` 中的仓库、锁文件、格式、类型、构建和
测试检查可重复执行，其中浏览器测试需要可用的本机 Chrome/Playwright 环境。

## 构建便携发行物

```powershell
npm run package:portable
```

该命令会：

1. 从 Node.js 官方下载固定 Windows x64 归档并验证 SHA-256。
2. 使用固定运行时完成生产构建。
3. 运行 `npm ci --omit=dev --ignore-scripts`，不执行第三方生命周期脚本。
4. 执行生产依赖漏洞审计和签名/来源证明验证。
5. 生成 CycloneDX JSON SBOM、源提交元数据和逐文件 SHA-256 清单。
6. 检查发行目录不含实际配置、模板、密钥、数据或私有协议目录。
7. 压缩发行目录并为 ZIP 生成外部 SHA-256。
8. 将 ZIP 解压到隔离临时目录，再次验证逐文件清单和敏感路径边界。
9. 在临时目录运行初始化脚本，使用随机空闲端口启动便携入口并检查健康接口。

缓存位于被忽略的 `.release-cache/`，发行物位于被忽略的 `release/`。缓存归档每次使用前
都会重新计算摘要；固定运行时版本不匹配时会重新解压。

## 独立验证

收到发行目录和 ZIP 后，在未修改暂存目录的情况下运行：

```powershell
npm run package:verify
Get-Content release/local-automation-server-win-x64.zip.sha256
```

验证器会检查暂存目录及 ZIP 解压内容中的每个文件、ZIP 摘要、Node.js 版本和敏感路径
边界，并执行一次隔离启动烟雾测试。`MANIFEST.sha256` 不包含自身摘要；ZIP 的摘要保存
在包外，避免自引用。临时验证目录位于 `.release-cache/`，无论成功或失败都会尝试清理。

发布元数据中的 `sourceDirty` 应为 `false`。若为 `true`，说明发行物来自未提交工作树，
只能用于本机验收，不应作为正式版本分发。正式发布还应保留对应 Git 提交、ZIP、外部
摘要和 SBOM。

## 正式版本固化

通过全部检查后，先提交冻结后的源码，再从干净工作树构建并独立验证发行物。确认
`release-metadata.json` 的 `sourceCommit` 指向该提交且 `sourceDirty` 为 `false` 后，创建
与 `package.json` 一致的带注释标签：

```powershell
git tag -a v0.1.0 -m "Local Automation Server v0.1.0"
```

标签不得早于联网依赖审计、完整测试和便携包验证。发布 ZIP、`.sha256` 与 SBOM 应与该标签
对应保存，但继续保留在 Git 仓库之外。

## 容器发布

`.github/workflows/container.yml` 使用相同源码执行三个隔离作业：

1. `quality` 获取完整 Git 历史，安装锁定依赖，运行联网依赖漏洞/签名审计、完整
   `npm run check` 和独立容器烟雾测试。
2. PR 的 `validate` 使用 QEMU/Buildx 构建 `linux/amd64` 与 `linux/arm64`，但没有包写权限，
   也不会推送镜像。
3. `main`、`v*` 或维护者手动运行的 `publish` 在质量门禁通过后，使用仓库自带的
   `GITHUB_TOKEN` 推送 GHCR，不需要长期 PAT。

发布标签策略：

| Git 引用        | 容器标签                                        |
| --------------- | ----------------------------------------------- |
| `main`          | `edge`、`sha-<提交摘要>`                        |
| `vX.Y.Z`        | `X.Y.Z`、`X.Y`、`X`、`latest`、`sha-<提交摘要>` |
| `vX.Y.Z-<预览>` | 完整预发行版本与提交摘要，不移动 `latest`       |
| 手动运行        | 提交摘要；默认分支同时更新 `edge`               |

任何 `v*` 标签必须严格等于 `v` 加 `package.json` 的版本，否则在登录注册表前失败。正式发布应
先完成便携包验证和源码提交，再创建标签。不要删除并重建同名版本标签；修复后递增语义化版本。

镜像发布同时生成 BuildKit SPDX SBOM 与 `mode=max` provenance，向 GHCR 写入 GitHub
artifact attestation，并使用 GitHub Actions OIDC 完成 Sigstore 无密钥签名。第三方 Actions
全部固定到 40 位提交 SHA；`.github/dependabot.yml` 只负责提出审阅后的升级 PR。

首次工作流成功后，在 GitHub 包设置中确认
`ghcr.io/tntexploding/localwebserver` 已连接本仓库并设为公开。验证命令与部署方法见
[Docker 部署指南](docker.md)。
