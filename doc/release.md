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
