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

提交前运行：

```powershell
npm run format
npm run check
```

`npm run check` 依次执行非写入格式检查、GTS lint、全部工作区类型检查和生产构建。

## 修改边界

- 共享类型或规则行为放在 `packages/core`。
- 文件存储与配置持久化放在 `packages/storage`。
- 网络、执行和进程生命周期放在 `apps/server`。
- 表现、交互和本地化放在 `apps/web`。
- 新的界面文案必须同时加入 `zh-CN.json` 与 `en-US.json`。

## 添加配置字段

1. 更新 `packages/core/src/types.ts`。
2. 更新 `packages/core/src/schemas.ts`，为可选值提供明确默认值。
3. 更新读取或执行该字段的后端模块。
4. 更新 WebUI 编辑器和两份本地化文件。
5. 更新 `doc/configuration.md` 或相应协议文档。
6. 执行 `npm run check`。

## 添加消息模板

在 `config/templates` 创建 `.json` 文件，并遵循 [消息模板标准](message_template_standard.md)。模板应提供最小有效消息、全部字段元数据、至少一个可通过 Schema 的示例以及必要的安全说明。
