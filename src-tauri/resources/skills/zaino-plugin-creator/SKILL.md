---
name: zaino-plugin-creator
description: 为 Zaino AI Agent 桌面客户端创建、修改、迭代插件（Tier-0 声明式 CSS/JSON，或 Tier-1 单文件 ESM）。当用户要"做一个插件 / 给 Zaino AI Agent 加个功能 / 改输入框或界面样式 / 加设置页、侧边栏或状态栏入口 / 加面板页签或命令面板命令 / 把某套工作流包装成插件 / 改一下我做过的那个插件"，或提到 zaino 插件、插件目录、从本地目录安装插件时使用。
---

# Zaino AI Agent 插件创建

产出是**一个可被 Zaino AI Agent 直接安装的目录**（不是仓库、不是 PR）：用户在 Zaino AI Agent 侧边栏「插件」→「从本地目录安装」选这个目录即可生效。

## 前置检查

在动手之前确认三件事：

1. **SDK 版本**：当前宿主 SDK 版本写在 `references/sdk-api.md` 顶部；所有 API 以该文档为准，不要凭记忆猜测方法名或权限名。
2. **权限清单**：`manifest.permissions` 只接受 spec/permissions.json 中列出的基础权限和 `network:`/`exec:` grant；调用未声明的能力会抛错。
3. **Tier 选择**：Tier-0 = 纯声明式（CSS/JSON/i18n），零 JS；Tier-1 = 单文件 ESM（`index.mjs` + `manifest.json`）。优先 Tier-0，仅在需要运行时逻辑时才用 Tier-1。

## 目录结构

```
my-plugin/
├── manifest.json          # 必需，插件元数据与能力声明
├── index.mjs              # Tier-1 必需；Tier-0 不需要
├── docs/                  # 可选，截图与图标放这里
│   ├── icon.png           # 推荐 256×256 PNG
│   ── screenshot-1.png
└── locales/               # 可选，i18n 翻译文件
    └── en.json
```

### manifest.json 字段速查

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | required | 唯一标识符，小写 kebab-case |
| `name` | `string` | required | 显示名称 |
| `version` | `string` | required | Semver x.y.z |
| `minAppVersion`? | `string` | optional | 最低宿主版本 |
| `sdkVersion`? | `string` | optional | SDK 版本范围（"^0.4"/"~0.4.0"/">=0.4.0"/exact/"*"），默认 "*" |
| `author`? | `string` | optional | 作者 |
| `description`? | `string` | optional | 描述 |
| `tier` | `PluginTier` | required | `"tier-0"` 或 `"tier-1"` |
| `permissions` | `string[]` | required | 基础权限 + network:/exec: grants |
| `contributes`? | object | optional | Tier-0 声明式能力（themes/i18n/statusBarItems/commands） |
| `configSchema`? | JsonSchemaObject | optional | JSON Schema，宿主自动渲染配置表单 |
| `icon`? | `string` | optional | 市场图标路径（相对 docs/ 或 https URL） |
| `screenshots`? | `string[]` | optional | 市场详情页截图，最多 5 张 |

## Tier-0 插件（声明式）

无需 JS，仅靠 `manifest.json` 的 `contributes` 字段注册能力：

```json
{
  "id": "my-status-bar",
  "name": "My Status Bar",
  "version": "1.0.0",
  "tier": "tier-0",
  "permissions": ["ui:status-bar"],
  "contributes": {
    "statusBarItems": [
      { "key": "hello", "text": "Hello from plugin" }
    ]
  }
}
```

支持的 contributes 类型：
- `themes`: 主题 token 覆盖
- `i18n`: 翻译包
- `statusBarItems`: 状态栏条目
- `commands`: 命令面板条目

## Tier-1 插件（ESM）

需要 `index.mjs` 导出 `activate` 函数：

```js
export default function activate(ctx) {
  // ctx.ui.registerStatusBarItem(...)
  // ctx.storage.set(...)
  // ctx.events.on(...)

  return () => {
    // 卸载清理函数（可选）
  };
}
```

### 常用扩展点

| Entry point | Permission | Description |
|---|---|---|
| `ctx.ui.registerSettingsSection` | `ui:settings-section` | 设置页区块 |
| `ctx.ui.registerPanelTab` | `ui:panel-tab` | 聊天右侧面板页签 |
| `ctx.ui.registerStatusBarItem` | `ui:status-bar` | 应用状态栏条目 |
| `ctx.ui.registerCommand` | `ui:command` | 命令面板条目 |
| `ctx.ui.registerCenterTab` | `ui:center-tab` | 中心区域页签 |
| `ctx.ui.registerSidebarNav` | `ui:sidebar-entry` | 主页侧边栏导航条目 |
| `ctx.storage.set/get/delete` | `storage` | 插件隔离存储 |
| `ctx.events.on/emit` | `events` | 事件总线 |
| `ctx.agent.start/interrupt` | `agent` | 启动/中断 agent turn |
| `ctx.sessions.startRun` | `host:session` | 作为宿主会话启动 turn |
| `ctx.workspaces.add/list` | `host:workspace` | 工作区管理 |
| `ctx.models.catalog` | `host:models` | 模型目录查询 |
| `ctx.bridge.invoke` | network:/exec: grants | HTTP 请求 / 执行子进程 |

完整签名见 `references/sdk-api.md`。

## 权限系统

`manifest.permissions` 只接受以下基础权限或合法的 `network:`/`exec:` grant：

| Permission | Gated entry point |
|---|---|
| `storage` | `ctx.storage.get/set/delete` |
| `ui:settings-section` | `ctx.ui.registerSettingsSection/openSettings` |
| `ui:add-menu` | `ctx.ui.registerAddMenuRow` |
| `ui:composer-status` | `ctx.ui.registerComposerSlot/registerComposerStatusItem` |
| `ui:panel-tab` | `ctx.ui.registerPanelTab` |
| `ui:status-bar` | `ctx.ui.registerStatusBarItem` |
| `ui:overlay` | `ctx.ui.registerOverlay` |
| `ui:command` | `ctx.ui.registerCommand` |
| `ui:markdown` | `ctx.ui.registerMarkdownRenderer` |
| `ui:page` | `ctx.ui.registerPage` |
| `ui:timeline-row` | `ctx.ui.registerTimelineRowRenderer` |
| `ui:workspace-menu` | `ctx.ui.registerWorkspaceMenuItem` |
| `ui:session-menu` | `ctx.ui.registerSessionMenuItem` |
| `ui:sidebar-entry` | `ctx.ui.registerSidebarNav` |
| `ui:center-tab` | `ctx.ui.registerCenterTab/openCenterTab` |
| `ui:conversation-mode` | `ctx.ui.registerConversationMode` |
| `agent` | `ctx.agent.catalog/start/interrupt` |
| `theme` | `ctx.theme.injectCss/setTokens` |
| `i18n` | `ctx.i18n.addBundle` |
| `events` | `ctx.events.on/emit` |
| `composer:draft` | `ctx.composer.setDraft` |
| `host:session` | `ctx.sessions.*` |
| `host:workspace` | `ctx.workspaces.add/list` |
| `host:workspace:remote` | `ctx.workspaces.add` (WSL/SSH) |
| `host:worktree` | `ctx.worktrees.create/remove` |
| `host:window` | `ctx.window.getState/setNormalBounds/sampleWechat` |
| `host:models` | `ctx.models.listEngines/listEngineModels/catalog` |
| `session.lifecycle.read` | `ctx.hooks.registerSessionHooks` |
| `runtime.events.read` | `ctx.hooks.registerTurnHooks` |
| `runtime.switch.observe` | `ctx.hooks.registerRuntimeSwitchHooks` |
| `prompt.contribute.internal` | `ctx.hooks.registerTurnHooks` |
| `workspace.metadata.read` | `ctx.workspace.getMetadata` |
| `plugin.storage` | `ctx.documentStorage.*` / `ctx.assets.documentUrl` |
| `assets:bundle` | `ctx.assets.bundleUrl` |
| `assets:directory` | `ctx.assets.grantDirectory/listDirectories/revokeDirectory/directoryUrl` |

### network: / exec: grant 格式

- `network:<host>`（任意端口）/ `network:<host>:<port>` / `network:<host>:<a>-<b>`
  - 主机必须精确匹配（不区分大小写，无通配符，子域名不匹配），仅 http/https
  - 示例：`network:127.0.0.1`、`network:api.example.com:8443`
- `exec:<bin>`：裸二进制名（`^[A-Za-z0-9._-]+$`，无路径分隔符），精确匹配，区分大小写
- `network:none` 是基础权限，表示"此插件不使用网络"，**不是** grant

bridge 命令表（通过 `ctx.bridge.invoke`）：

| bridge command | Required grant |
|---|---|
| `plugin_http_request` | `network:<host>` grant |
| `plugin_exec_run`、`plugin_exec_spawn` | `exec:<bin>` grant |
| `plugin_exec_kill` | any `exec:` grant |
| `plugin_agent_start`、`plugin_agent_interrupt` | `agent` |

## 安装与调试

1. **安装**：Zaino AI Agent 侧边栏「插件」→「从本地目录安装」→ 选插件目录（里面有 `manifest.json` 的那一层）。
2. **热重载**：修改 Tier-1 插件后，在插件设置页点击「重新加载」；Tier-0 修改 `manifest.json` 后同样操作。
3. **卸载**：插件列表 → 对应插件 → 「卸载」。
4. **日志**：开发者工具 Console 中过滤 `[plugin:<id>]` 查看插件输出。

## 发布到市场

插件是一个托管在 GitHub 上的独立仓库，通过 GitHub Releases 分发：

1. 创建公开仓库，包含 `manifest.json` + 代码 + `docs/icon.png`
2. 打 tag（与 `version` 一致），创建 Release 并上传源码 zip
3. 提交市场申请（仓库 URL + Release tag）
4. 审核通过后用户可一键安装/升级

## 注意事项

- **不要猜测 API**：任何不在 `references/sdk-api.md` 中的方法都不存在
- **先声明权限再写代码**：调用未声明的能力会立即抛错
- **优先 Tier-0**：能用声明式解决的不要用 JS
- **自包含原则**：插件不能引用远程资源（`@import url(...)`、远程图片等会被拒绝）
- **卸载清理**：返回的 cleanup 函数会在卸载时首先执行，然后按注册逆序执行所有 Disposer