# 贡献指南

感谢你改进 Local Automation Server。提交改动前，请先阅读
[架构说明](doc/architecture.md)、[开发指南](doc/development.md) 和
[安全说明](SECURITY.md)。

## 开发环境

推荐使用 Node.js 24.18.1 或更新的 24.x，以及 npm 10 或更高版本：

```powershell
npm ci --ignore-scripts
npm run check
```

测试必须使用脱敏示例或独立临时工程，不得读取开发者的实际 `config/`、`data/` 或消息
模板。端到端测试应通过构建入口和公开协议验证行为，避免把测试辅助代码耦合进生产模块。

## 提交要求

- 保持改动聚焦，并沿用现有 TypeScript、React、Fastify 和存储边界。
- TypeScript 由 GTS/ESLint 检查，Markdown、JSON、YAML、CSS 和脚本由 Prettier 检查。
- 新行为应包含与风险和影响范围相称的单元、端到端或浏览器测试。
- 不提交真实端点、自动化、动作、消息模板、QQ 标识、令牌、Cookie、日志、媒体或发行物。
- 新增依赖前说明用途，并确认许可证、安装脚本、注册表来源和完整性信息符合项目策略。

提交前运行：

```powershell
npm run audit:repo
npm run audit:lock
npm run check
npm run audit:dependencies
```

`audit:dependencies` 需要访问 npm 公共注册表。无法联网时应在合并前由其他可信环境补跑，
不能把离线结果描述为完整依赖审计。

## 安全问题

安全漏洞不要通过公开 issue 或附带真实数据的测试用例披露。请使用
[私密安全报告](https://github.com/tntexploding/LocalWebServer/security/advisories/new)。
