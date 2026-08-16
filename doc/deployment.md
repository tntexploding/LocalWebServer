# Windows 部署

## 运行环境

源码部署推荐 Node.js 24.18.1 或更新的 24.x。`npm run runtime:check` 和后端正式入口都会
读取 `release.config.json`；版本偏差只产生兼容性提示，不会阻止启动。建议使用锁文件安装：

```powershell
npm ci --ignore-scripts
npm run secrets:init
npm start
```

后端构建并托管 `apps/web/dist`，默认入口为 `http://127.0.0.1:4789/ui/`，生产运行不需要
另开 Vite。跨主机访问必须重新评估 TLS、监听地址、来源白名单、令牌和防火墙。

## 登录时启动

项目使用当前用户的 Windows 计划任务，不申请管理员权限，也不注册系统服务：

```powershell
npm run startup:install
npm run startup:status
npm run startup:uninstall
```

任务在登录时隐藏启动 `scripts/windows/run-server.ps1`，日志写入
`data/startup-agent.log`。项目目录移动后，应先卸载旧任务再重新安装。

## Windows 便携包

```powershell
npm run package:portable
npm run package:verify
```

打包器会下载 `release.config.json` 固定的 Node.js Windows x64 运行时，验证官方归档
SHA-256，再用该运行时构建与安装生产依赖。输出包括：

- `release/local-automation-server-win-x64.zip`
- `release/local-automation-server-win-x64.zip.sha256`
- `release/local-automation-server/` 可检查的暂存目录
- 包内 `SBOM.cdx.json`、`MANIFEST.sha256` 与 `release-metadata.json`

包内不会包含实际 `config/*.yaml`、`config/templates/`、`doc/template/`、`data/` 或测试目录。
解压后先运行 `initialize.cmd`，再运行 `start.cmd`。初始化只在文件不存在时复制脱敏示例，
并生成独立随机令牌，不覆盖已有配置。

完整发布步骤与验证命令见 [发布流程](release.md)。

## 自定义运行根目录

`LAS_ROOT_DIR` 可将运行配置和 `data/` 放到代码目录之外；`LAS_SECRETS_PATH` 可指定密钥
文件位置。相对路径以运行根目录为基准，并且受管路径不得逃出该目录。WebUI 构建仍从
程序目录加载，因此部署包中的 `apps/web/dist` 必须保留。
