# 开发指南

## 代码风格

TypeScript 遵循 Google TypeScript Style Guide，并通过 GTS 自动检查。Markdown、JSON、YAML、CSS 和脚本由同一套 Prettier 配置格式化。

基本约定：

- 使用两个空格缩进、UTF-8、LF 和文件末尾换行。
- 导出的领域对象优先使用 `interface`，联合类型使用 `type`。
- 仅导入类型时使用 `import type`。
- 顶层公共 API 使用简短 JSDoc 描述行为或约束。
- 内部模块使用命名导出和相对路径，不使用 TypeScript namespace。
- 不提交 `dist`、`*.tsbuildinfo`、运行日志或 `data`。
- 不提交实际 `config/*.yaml`、消息模板、协议样例、环境变量文件、密钥或凭据。

## 工作流

安装依赖并启动：

```powershell
npm install
npm run dev
```

根启动器按以下顺序工作：

1. 从本机 `config/app.yaml` 读取控制 API 地址，从 `config/web.yaml` 读取 Vite 地址。
2. 校验 WebUI 来源已列入 `security.corsOrigins`，再检查后端与 WebUI 端口是否可用；来源遗漏、端口占用或 Windows 端口权限错误都会立即终止并给出明确原因。
3. 构建共享包，然后并行启动后端与 Vite；Vite 不会静默改用其他端口。
4. 同时等待 `/api/health` 与 WebUI 返回成功；任一端失败都会输出对应诊断并关闭整组进程。
5. 收到 `Ctrl+C` 或任一子进程异常退出时，关闭整组前后端进程。Windows 下会清理对应的子进程树。

调整 `web.yaml` 后，还需将对应来源加入 `app.yaml` 的 `security.corsOrigins`。开发启动器会把由两份配置计算出的 API 地址传给 Vite，不再使用源代码中的地址或端口回退值。

提交前运行：

```powershell
npm run format
npm run check
```

`npm run check` 依次执行 Node.js 版本建议、仓库/Git 历史敏感边界、锁文件供应链、非写入
格式、GTS lint、全部工作区类型检查、生产构建、单元测试、独立进程 E2E 和 Chrome 交互
测试。联网发布前还应单独执行 `npm run audit:dependencies`，获取最新漏洞数据并验证依赖
签名和来源证明。

可分层运行：

```powershell
npm run test:unit
npm run test:e2e
npm run test:browser
```

根目录 `tests/` 不导入 `apps/server/src` 或修改主程序依赖注入。E2E 只启动已构建入口，
通过临时 `LAS_ROOT_DIR`、公开 HTTP/WS 和磁盘结果验收；浏览器测试也使用同一独立夹具。
不得为了测试向生产 API 添加后门、测试模式或固定端口。详细边界见
[`tests/README.md`](../tests/README.md)。

## 修改边界

- 共享类型或规则行为放在 `packages/core`。
- 文件存储与配置持久化放在 `packages/storage`。
- 网络、执行和进程生命周期放在 `apps/server`。
- 表现、交互和本地化放在 `apps/web`。
- 新的界面文案必须同时加入 `zh-CN.json` 与 `en-US.json`。
- 跨模块行为优先通过公开领域类型和网络协议测试，不从独立验收工程引用内部类。

## 添加配置字段

1. 更新 `packages/core/src/types.ts`。
2. 更新 `packages/core/src/schemas.ts`，为可选值提供明确默认值。
3. 更新读取或执行该字段的后端模块。
4. 更新 WebUI 编辑器和两份本地化文件。
5. 更新 `doc/configuration.md` 或相应协议文档。
6. 执行 `npm run check`。

配置格式发生不兼容变化时，还需更新 `CURRENT_CONFIG_VERSION` 和显式迁移步骤；不允许
静默猜测未来版本。迁移前必须保留历史快照。

## 添加消息模板

在 `config/templates` 创建 `.json` 文件，并遵循 [消息模板标准](message_template_standard.md)。模板应提供最小有效消息、全部字段元数据、至少一个可通过 Schema 的示例以及必要的安全说明。
