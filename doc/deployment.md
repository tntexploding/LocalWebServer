# Windows 部署

## 生产式本机运行

```powershell
npm install
npm run build
npm run secrets:init
npm start
```

后端会托管 `apps/web/dist`，默认入口为 `http://127.0.0.1:4789/ui/`。生产运行只需要一个后端进程，不需要另开 Vite。

## 登录时启动

项目使用当前用户的 Windows 计划任务，不申请管理员权限，也不注册系统服务：

```powershell
npm run startup:install
npm run startup:status
npm run startup:uninstall
```

安装前必须完成生产构建。任务在当前用户登录时隐藏启动
`scripts/windows/run-server.ps1`，日志写入 `data/startup-agent.log`。项目目录被移动后，应先卸载旧任务再重新安装。

## Windows 便携包

```powershell
npm run package:portable
```

输出位于 `release/local-automation-server-win-x64.zip`。压缩包包含当前 Node.js 可执行文件、生产依赖、构建产物、示例配置和文档；不会包含实际 `config/*.yaml`、`config/templates/`、`doc/template/`、`data/` 或测试目录。

解压后首次运行：

```text
initialize.cmd
start.cmd
```

`initialize.cmd` 只在文件不存在时复制示例配置，并生成独立的本机密钥文件；不会覆盖已有配置。启动后打开默认 `/ui/` 地址。部署到其他主机后必须重新检查监听地址、来源白名单、CORS、允许命令目录和防火墙。

## 自定义运行根目录

`LAS_ROOT_DIR` 可将运行配置和 `data/` 放到代码目录之外；`LAS_SECRETS_PATH` 可指定密钥文件位置。相对密钥路径以运行根目录为基准。WebUI 构建仍从程序目录加载，因此部署包的 `apps/web/dist` 必须保留。
