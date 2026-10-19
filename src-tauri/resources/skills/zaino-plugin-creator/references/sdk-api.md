<!-- Generated from source by src/features/plugins/skill/creator-skill-docs.ts. Do not edit by hand. -->
<!-- Regenerate: pnpm plugin-skill:docs (creator-skill-docs.test.ts asserts this file matches the generator). -->

# Zaino AI Agent Plugin SDK Reference (SDK 0.3.20)

This file is derived by script from `packages/plugin-sdk` (the public contract) and the host runtime (permission gates). It belongs to the `zaino-plugin-creator` skill.
Fields, methods, and permissions are authoritative here: **any API not in this document does not exist** — never guess a method or permission name from memory.

## manifest.json fields

```ts
export default function activate(ctx: PluginContext): void | (() => void) {
  …
}
```

The optional return value is the unload cleanup function: it runs first on unload, then every Disposer runs in reverse registration order; the plugin never needs to (and should not) keep its own Disposer list.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | required | — |
| `name` | `string` | required | — |
| `version` | `string` | required | Semver three segments (x.y.z). |
| `minAppVersion`? | `string` | optional | The minimum host version required. |
| `sdkVersion`? | `string` | optional | The SDK version range required ("^0.4" / "~0.4.0" / ">=0.4.0" / exact / "*"). Default = "*" (no check). When the host SDK does not satisfy it the plugin goes incompatible. |
| `author`? | `string` | optional | — |
| `description`? | `string` | optional | — |
| `tier` | `PluginTier` | required | — |
| `permissions` | `string[]` | required | Base permissions and `network:`/`exec:` grants; the full set and shape rules live in spec/permissions.json (the single source of truth). `network:none` is a base permission (declares no network), never a grant. |
| `contributes`? | `{ themes?: { name?: string; tokens: { light?: Record<string, string>; dark?: Record<string, string> } }[]; i18n?: { lang: string; ns?: string; resources: Record<string, unknown> }[]; statusBarItems?: { key?: string; text: string }[]; commands?: { key: string; title: string; emits?: string }[] }` | optional | — |
| `configSchema`? | `JsonSchemaObject` | optional | JSON Schema object; the settings UI auto-renders a config form. |
| `icon`? | `string` | optional | A square icon for the marketplace: a repo-relative path (recommended under `docs/`, e.g. `docs/icon.png`) or an absolute https URL. Default = the marketplace renders a tile with the plugin name's first letter. A panel tab that registers no `icon` also falls back to it: marketplace installs copy the indexed brand image into the plugin directory by relative path (the release package need not bundle the image), and an absolute URL is loaded over the network directly. |
| `screenshots`? | `string[]` | optional | Marketplace detail-page screenshots: a repo-relative path or an absolute https URL, up to 5, shown in array order. Default = the detail page renders no gallery. Images are read by path from the plugin repo's default branch, so swapping them needs no release. |

Field value rules (`id` naming, how `version` maps to the Release tag, `tier` values, `configSchema` rendering scope, declarative `contributes` capabilities) are in `references/development-guide.md` §5 and §8.

### Version handshake

- `sdkVersion` accepts `"*"`, exact `"0.3.13"`, `"^0.3"`, `"~0.3.0"`, `">=0.3.0"`; anything else never satisfies (the plugin goes incompatible — the host never lets it through silently).
- Runtime self-checks use `ctx.host.sdkVersion` / `ctx.host.appVersion`; the host compares `minAppVersion` before loading.

## Extension points and required permissions

Declarative capabilities go in the manifest's `contributes` (Tier-0, zero JS); the table below lists the registration entry points for JS plugins.
**The permission column is not advisory**: calling something without declaring it in manifest `permissions` throws (`used <capability> without declaring it`) — declare the permission first, then write the code.

| Entry point | Permission | Description |
|---|---|---|
| `ctx.hooks.registerSessionHooks` | `session.lifecycle.read` | — |
| `ctx.hooks.registerTurnHooks` | `runtime.events.read` (+ `prompt.contribute.internal`, as needed) | — |
| `ctx.hooks.registerRuntimeSwitchHooks` | `runtime.switch.observe` | — |
| `ctx.workspace.getMetadata` | `workspace.metadata.read` | Stable host-registered workspace identity for the active path. |
| `ctx.ui.registerConversationMode` | `ui:conversation-mode` | — |
| `ctx.ui.registerSettingsSection` | `ui:settings-section` | — |
| `ctx.ui.registerAddMenuRow` | `ui:add-menu` | — |
| `ctx.ui.registerComposerSlot` | `ui:composer-status` | Extra control rendered beside a composer slot's builtin control (plan §4.2 #2). Permission `ui:composer-status` (shared with registerComposerStatusItem — both gate on the same composer-area grant; there is no separate `ui:composer` permission). |
| `ctx.ui.registerPanelTab` | `ui:panel-tab` | Chat right-panel tab (plan §4.2 #4); renders with the active workspace path. The strip renders plugin tabs icon-only, so `icon` is the visible identity — without one the tab falls back to the plugin's artwork / letter tile, and the label stays a title/accessible name. |
| `ctx.ui.registerStatusBarItem` | `ui:status-bar` | App status-bar chip (plan §4.2 #8). |
| `ctx.ui.registerComposerStatusItem` | `ui:composer-status` | Composer status-row chip (permission `ui:composer-status`, 0.3.9): renders in the composer's status row (branch/context meter row), left group after the branch switcher. |
| `ctx.ui.registerOverlay` | `ui:overlay` | Persistent viewport mount; requires ui:overlay. The plugin controls placement and opts interactive children into pointer-events: auto. |
| `ctx.ui.registerCommand` | `ui:command` | Command palette entry (plan §4.2 #9). |
| `ctx.ui.registerSessionMenuItem` | `ui:session-menu` | Sidebar session right-click menu row (permission `ui:session-menu`, since 0.3.5). `run` receives the session whose menu was opened: `{ engine, sessionId }`. |
| `ctx.ui.openSettings` | `ui:settings-section` | Jump to this plugin's settings page (permission `ui:settings-section`, since 0.3.6). `key` matches a sub-key of registerSettingsSection; omit it to open the main section. For deep links from status-bar chips, panel buttons, and the like. |
| `ctx.ui.registerMarkdownRenderer` | `ui:markdown` | Markdown pipeline additions, merged over host defaults (plan §4.2 #5). |
| `ctx.ui.registerPage` | `ui:page` | Overlay page at `#/p/<id>` (plan §4.2 #10). |
| `ctx.ui.registerTimelineRowRenderer` | `ui:timeline-row` | Renderer for a plugin-defined chat timeline row kind (plan §4.2 #5). The row payload is plugin-defined and typed loosely — blob bundles can't share the host's TimelineRow type identity. |
| `ctx.ui.registerWorkspaceMenuItem` | `ui:workspace-menu` | Sidebar workspace row context-menu entry. |
| `ctx.ui.registerSidebarNav` | `ui:sidebar-entry` | Home sidebar nav entry under the builtin Mission Workbench row (permission `ui:sidebar-entry`, 0.3.12). `onOpen` usually opens the plugin's center tab via openCenterTab. |
| `ctx.ui.registerCenterTab` | `ui:center-tab` | Center-area tab definition (permission `ui:center-tab`, 0.3.12): renders in the center tab strip like session/file/browser tabs. Opening goes through openCenterTab; multiple keys = multiple tabs. |
| `ctx.ui.openCenterTab` | `ui:center-tab` | Open (or focus) one of this plugin's registered center tabs (permission `ui:center-tab`, 0.3.12). Throws when the tab was never registered — open failures must be visible, not silent. |
| `ctx.theme.injectCss` | `theme` | Inject a stylesheet scoped to this plugin; removed on unload. Rejects remote references (`@import`, `url(http…)`): plugins must be self-contained (plan §8 gate rules). |
| `ctx.theme.setTokens` | `theme` | Shorthand for BoardUI token overrides: keys must be `--*` custom properties; emits `:root {…}` and `.dark {…}` blocks. |
| `ctx.i18n.addBundle` | `i18n` | — |
| `ctx.storage.set` | `storage` | — |
| `ctx.storage.delete` | `storage` | — |
| `ctx.events.on` | `events` | — |
| `ctx.events.emit` | `events` | — |
| `ctx.composer.setDraft` | `composer:draft` | — |
| `ctx.workspaces.add` | `host:workspace` (+ `host:workspace:remote`, as needed) | — |
| `ctx.workspaces.list` | `host:workspace` | A sidebar workspace snapshot (read-only; permission `host:workspace`, since 0.3.16). Worktree child rows additionally carry a read-only `worktree: { branch, prNumber? }` projection (since 0.3.17), which binds a PR to a local worktree; field definitions live in `PluginWorkspaceRow`, and `meta` itself is still not returned. |
| `ctx.worktrees.create` | `host:worktree` | — |
| `ctx.worktrees.remove` | `host:worktree` | Remove a local worktree (permission `host:worktree`, since 0.3.19): goes through the host sidebar's delete flow — `git worktree remove` (optionally deleting the branch) plus deregistering the sidebar/terminal entries. A rejection message looks like "<errorKind>: <detail>" (errorKind uses the same classification as creation, plus not_found / remove_failed). It resolves with non-fatal tails: `orphanDirectory` (the directory could not be removed) and `branchKeptReason` ("checked_out_elsewhere" \| "unknown"; null = the branch was deleted or deletion was not requested). |
| `ctx.sessions.selectSession` | `host:session` | — |
| `ctx.sessions.refresh` | `host:session` | Ask the host to refresh the session directory (sidebar/tabs) now, since 0.3.7. Call this after writing session data behind the host's back (e.g. a sqlite custom_title, a transcript title row) — otherwise the change stays invisible until the user syncs manually or the next regular refresh. |
| `ctx.sessions.setEffort` | `host:session` | Change an existing session's effort level, since 0.3.10. Writes host session state directly and persists it (equivalent to the user switching levels in the session; refreshSessions will not roll it back). An unknown session or an empty effort fails with a rejection — no ghost session entry is created. |
| `ctx.sessions.startRun` | `host:session` | Run an AI turn as a **host chat session** (since 0.3.18, permission `host:session`): the session appears in the sidebar immediately (with running state, no manual sync needed) and opens onto a live stream; it can be stopped from the chat or via `interruptRun`. The session hangs under the `workspacePath` workspace, and the model/effort/channel override applies to this turn only, leaving the user's global defaults untouched. How it differs from `ctx.agent.start`: that one is the plugin's own background turn (events go only to the plugin, never into chat); this one is "as if the user sent a message". Use this method for turns the user should see and can take over or stop at any time. After a successful spawn it resolves with `{ runId, sessionId }` (sessionId is null when the engine announces it later); termination is reported back over the `plugin-run://<pluginId>` event channel, and turns interrupted by the user or the plugin still finish with `done`. |
| `ctx.sessions.interruptRun` | `host:session` | Stop a turn started by `startRun` (equivalent to the chat's stop button). |
| `ctx.sessions.registerSource` | `host:session` | — |
| `ctx.window.getState` | `host:window` | — |
| `ctx.window.setNormalBounds` | `host:window` | — |
| `ctx.window.sampleWechat` | `host:window` | — |
| `ctx.models.listEngines` | `host:models` | — |
| `ctx.models.listEngineModels` | `host:models` | — |
| `ctx.models.catalog` | `host:models` | Aggregated safe catalog. Provider endpoints are contacted only when refreshProviders is true (must be tied to an explicit user action). |
| `ctx.agent.catalog` | `agent` | — |
| `ctx.agent.start` | `agent` | Start an agent turn; the returned runId is used for event filtering and interrupt. |
| `ctx.agent.interrupt` | `agent` | Interrupt a run this plugin started (the run id's owner prefix is enforced by the host). |

## Full PluginContext signature

The signatures below match the `@ccgui/plugin-sdk` source verbatim (types collapsed onto one line).

### ctx.hooks

```ts
hooks: {
  /** Permissions: session.lifecycle.read */
  registerSessionHooks(hooks: SessionHooks): Disposer;
  /** Permissions: runtime.events.read, prompt.contribute.internal */
  registerTurnHooks(hooks: TurnHooks): Disposer;
  /** Permissions: runtime.switch.observe */
  registerRuntimeSwitchHooks(hooks: RuntimeSwitchHooks): Disposer;
}
```

### ctx.workspace

```ts
workspace: {
  /** Permissions: workspace.metadata.read */
  getMetadata(): Promise<WorkspaceMetadata>;
}
```

### ctx.shell

```ts
shell: {
  revealPath(path: string): Promise<void>;
}
```

### ctx.ui

```ts
ui: {
  /** Permissions: ui:conversation-mode */
  registerConversationMode(def: { key?: string; label(): string; component: ComponentType<PluginConversationProps> }): Disposer;
  /** Permissions: ui:settings-section */
  registerSettingsSection(def: { key?: string; label(): string; icon?: ComponentType<{ className?: string }>; component: ComponentType }): Disposer;
  /** Permissions: ui:add-menu */
  registerAddMenuRow(def: { key?: string; label(): string; description?(): string; icon?: ComponentType<{ className?: string }>; onSelect(): void }): Disposer;
  /** Permissions: ui:composer-status */
  registerComposerSlot(def: { slot: ComposerSlotId; key?: string; component: ComponentType; order?: number }): Disposer;
  /** Permissions: ui:panel-tab */
  registerPanelTab(def: { key?: string; label(): string; icon?: ComponentType<{ className?: string }>; component: ComponentType<{ workspacePath: string }>; order?: number }): Disposer;
  /** Permissions: ui:status-bar */
  registerStatusBarItem(def: { key?: string; component: ComponentType; order?: number; zone?: "start" | "end" }): Disposer;
  /** Permissions: ui:composer-status */
  registerComposerStatusItem(def: { key?: string; component: ComponentType; order?: number }): Disposer;
  /** Permissions: ui:overlay */
  registerOverlay(def: { key?: string; component: ComponentType; order?: number }): Disposer;
  /** Permissions: ui:command */
  registerCommand(def: { key: string; title(): string; keywords?(): string[]; run(): void }): Disposer;
  /** Permissions: ui:session-menu */
  registerSessionMenuItem(def: { key?: string; label(): string; icon?: ComponentType<{ className?: string }>; danger?: boolean; run(target: SessionMenuTarget): void }): Disposer;
  /** Permissions: ui:settings-section */
  openSettings(key?: string): void;
  /** Permissions: ui:markdown */
  registerMarkdownRenderer(def: { key?: string; remarkPlugins?: unknown[]; rehypePlugins?: unknown[]; components?: Record<string, unknown> }): Disposer;
  /** Permissions: ui:page */
  registerPage(def: { key?: string; title(): string; component: ComponentType }): Disposer;
  /** Permissions: ui:timeline-row */
  registerTimelineRowRenderer(def: { kind: string; key?: string; component: ComponentType<{ row: { kind: string } }> }): Disposer;
  /** Permissions: ui:workspace-menu */
  registerWorkspaceMenuItem(def: { key?: string; label(ctx: { workspaceId: string; archived: boolean }): WorkspaceMenuLabelValue; icon?: ComponentType<{ className?: string }>; visible?(ctx: { workspaceId: string; archived: boolean }): boolean; onSelect(ctx: { workspaceId: string; archived: boolean }): void; order?: number }): Disposer;
  /** Permissions: ui:sidebar-entry */
  registerSidebarNav(def: { key?: string; label(): string; icon?: ComponentType<{ className?: string }>; order?: number; onOpen(): void }): Disposer;
  /** Permissions: ui:center-tab */
  registerCenterTab(def: { key?: string; title(): string; icon?: ComponentType<{ className?: string }>; component: ComponentType; order?: number }): Disposer;
  /** Permissions: ui:center-tab */
  openCenterTab(key?: string): void;
}
```

### ctx.theme

```ts
theme: {
  /** Permissions: theme */
  injectCss(css: string): Disposer;
  /** Permissions: theme */
  setTokens(tokens: { light?: Record<string, string>; dark?: Record<string, string> }): Disposer;
}
```

### ctx.i18n

```ts
i18n: {
  /** Permissions: i18n */
  addBundle(lang: string, ns: string, resources: Record<string, unknown>): Disposer;
}
```

### ctx.storage

```ts
storage: {
  get<T>(key: string): Promise<T | null>;
  /** Permissions: storage */
  set(key: string, value: unknown): Promise<void>;
  /** Permissions: storage */
  delete(key: string): Promise<void>;
}
```

### ctx.events

```ts
events: {
  /** Permissions: events */
  on(topic: string, cb: (data: unknown) => void): Disposer;
  /** Permissions: events */
  emit(topic: string, data: unknown): void;
}
```

### ctx.composer

Composer draft write (permission `composer:draft`, since 0.3.2). Writing replaces the draft of the currently active session; it never sends — sending is always a user action.

```ts
composer: {
  /** Permissions: composer:draft */
  setDraft(text: string): void;
}
```

### ctx.workspaces

Workspace registration and reads (permission `host:workspace`, since 0.3.3; `list` since 0.3.16). Register an arbitrary path as a sidebar workspace — the directory need not exist locally (e.g. a path inside an ssh-managed remote machine or WSL distribution). `meta` passes through onto the host workspace row; its shape is agreed between writer and consumer. `list` returns the sidebar's current workspace rows (including worktree child rows, distinguished by `kind`). It is a **read-only snapshot**: no `meta` (the private payload written by remote/other plugins) and no group definitions, only what a plugin needs to resolve repositories/paths per local workspace. Call it again to follow host changes; the host broadcasts no workspace change events to plugins. A `meta` carrying a `wsl` key (a remote workspace, where the host engine tunnels session traffic over ssh to the host and distribution named by meta.wsl) needs the extra permission `host:workspace:remote` (since 0.3.4) — that is effectively network egress plus remote execution, far beyond registering one sidebar row. Trust tradeoff: the remote channel's first connection uses StrictHostKeyChecking=accept-new (the host key is recorded on first connect and only later changes are rejected), so plugin authors should know this is TOFU rather than strict pinning.

```ts
workspaces: {
  /** Permissions: host:workspace, host:workspace:remote */
  add(path: string, meta?: Record<string, unknown>): Promise<void>;
  /** Permissions: host:workspace */
  list(): Promise<PluginWorkspaceRow[]>;
}
```

### ctx.worktrees

Worktree creation (permission `host:worktree`, since 0.3.17): created through the host's "New Worktree" pipeline (validate → fetch → add → register), with the same progress row and cancel/retry semantics in the host sidebar; on success the worktree is registered in the sidebar with `kind="worktree"` (its parent row is the workspace named by `parentWorkspaceId`), and resolves with the registered path. When `prNumber` is present it fetches `pull/<n>/head` before checking out; `existingBranch` means `branch` is an existing local branch (check out, not create). The default path is the host's default layout `<sibling of repo>/<repo name>-worktrees/<branch>`. Failure/cancel rejects with an `Error` whose message is `"<errorKind>: <detail>"` (the kind matches the host's error classification: not_a_repo / invalid_branch / branch_not_found / branch_exists / branch_checked_out / dir_exists / pr_not_found / fetch_failed / register_failed / sparse_checkout_empty / canceled / unknown), so plugins can render readable text.

```ts
worktrees: {
  /** Permissions: host:worktree */
  create(def: { repoPath: string; parentWorkspaceId: string; branch: string; baseRef?: string | null; prNumber?: number | null; prTitle?: string | null; prUrl?: string | null; existingBranch?: boolean }): Promise<{ worktreePath: string }>;
  /** Permissions: host:worktree */
  remove(def: { repoPath: string; worktreePath: string; branch?: string | null; deleteBranch?: boolean }): Promise<{ orphanDirectory: boolean; branchKeptReason: string | null }>;
}
```

### ctx.sessions

Session opening + external session sources (permission `host:session`; selectSession since 0.3.3, registerSource since 0.3.4). registerSource registers an async session source; the host calls `list()` on every session directory refresh (init/refreshSessions/rescan) and merges the rows into the sidebar list — local scan results win, and external rows with the same engine/sessionId/workspacePath are dropped. Returns a Disposer that auto-deregisters on unload.

```ts
sessions: {
  /** Permissions: host:session */
  selectSession(engine: string, sessionId: string, workspacePath: string): Promise<void>;
  /** Permissions: host:session */
  refresh(): Promise<void>;
  /** Permissions: host:session */
  setEffort(engine: string, sessionId: string, workspacePath: string, effort: string): Promise<void>;
  /** Permissions: host:session */
  startRun(def: { engine: string; prompt: string; workspacePath: string; model?: string | null; effort?: string | null; providerId?: string | null }): Promise<{ runId: string; sessionId: string | null }>;
  /** Permissions: host:session */
  interruptRun(def: { engine: string; workspacePath: string; sessionId?: string | null }): Promise<void>;
  /** Permissions: host:session */
  registerSource(def: { id: string; list(): Promise<ExternalSessionRow[]> }): Disposer;
}
```

### ctx.window

Main window access (permission `host:window`, since 0.3.19). Coordinates and sizes are in physical pixels; setNormalBounds only accepts a normal-state window and requires at least 64x64 pixels to fall on one of the current screens. sampleWechat samples by executable name Weixin.exe/WeChat.exe on Windows; other platforms reject with Unsupported, and a not-found executable rejects with NotFound.

```ts
window: {
  /** Permissions: host:window */
  getState(): Promise<PluginWindowSnapshot>;
  /** Permissions: host:window */
  setNormalBounds(bounds: PluginWindowBounds): Promise<PluginWindowSnapshot>;
  /** Permissions: host:window */
  sampleWechat(): Promise<PluginWechatWindow>;
}
```

### ctx.models

The host model catalog (permission `host:models`, since 0.3.19). Results come from the host's authoritative list_engines/list_engine_models and contain no API keys, tokens, or full provider config. workspace is optional; remote workspaces are probed from the remote host/WSL side that owns the CLI.

```ts
models: {
  /** Permissions: host:models */
  listEngines(): Promise<PluginEngineInfo[]>;
  /** Permissions: host:models */
  listEngineModels(engine: string, workspace?: string): Promise<PluginEngineCatalog>;
  /** Permissions: host:models */
  catalog(options?: { workspace?: string; refreshProviders?: boolean }): Promise<PluginModelCatalogResult>;
}
```

### ctx.agent

Agent turns (permission `agent`, since 0.3.13): starts an agent process through the host engine pipeline — structurally the same as channel injection, process registration, and a chat send. Events travel on a dedicated `agent://<pluginId>` bus topic (subscribe via ctx.events.on; the payload is the engine event envelope { runId, sessionId, engine, seq, kind, data, ts }, with kind ∈ delta | tool | usage | done | error …). Desktop only (plugins that are unavailable under isWeb must present themselves).

```ts
agent: {
  /** Permissions: agent */
  catalog(workspacePath: string): Promise<PluginAgentCatalogEntry[]>;
  /** Permissions: agent */
  start(def: { engine: string; prompt: string; workspacePath: string; model?: string; providerId?: string; sessionId?: string; readOnly?: boolean; requestId?: string }): Promise<{ runId: string; sessionId: string | null }>;
  /** Permissions: agent */
  interrupt(runId: string): Promise<boolean>;
}
```

### ctx.bridge

The general capability outlet (since 0.3.0; the old per-command `cmd:<command>` authorization mechanism was removed). Only the commands below are available, and `pluginId` is injected by the host (the plugin neither needs to nor may pass it): - `plugin_http_request` `{ method, url, headers?, body? }` → `{ status, body }`: the url is restricted to http/https, and the host (plus port) must match the manifest's `network:<host>` / `network:<host>:<port>` / `network:<host>:<a>-<b>` grant (shapes and allow rules live in spec/permissions.json). - `plugin_exec_run` `{ bin, args, env?, timeoutMs? }` → `{ code, stdout, stderr }`: bin must match an `exec:<bin>` grant (bare name, no path). The child process PATH is injected by the host as "the plugin env's PATH (if any, keeping priority) + the host's CLI search directories (the process PATH plus common install locations)", so `#!/usr/bin/env node`-style shims find their interpreter; a plugin cannot fully lock PATH down through env. - `plugin_exec_spawn` `{ bin, args, env?, lifecycle? }` → void: the same grant requirement; resolves to void on success (Rust returns ()), rejects on failure. PATH injection matches `plugin_exec_run`. lifecycle defaults to "detached" (a user-level service that outlives the plugin); "plugin" = a child process the host tracks and kills automatically when the plugin is disabled or uninstalled. - `plugin_exec_kill` `{}` → `{ killed: number }`: kills every lifecycle="plugin" child of this plugin (a config change renames it to re-enable; any exec: grant required). - `plugin_agent_start` / `plugin_agent_interrupt` (since 0.3.13): the same capability as `ctx.agent` (requires the `agent` permission) — the host takes over the engine pipeline and enforces the run id owner prefix in Rust. A call whose grant does not match is rejected on the JS side (no IPC round trip); Rust separately enforces grants and plugin enabled-state (defense in depth).

```ts
bridge: {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}
```

### ctx.host

```ts
host: {
  appVersion: string;
  sdkVersion: string;
  locale: string;
  isWeb: boolean;
}
```

### Scalar properties

```ts
ctx.pluginId: string;
ctx.version: string;
ctx.react: typeof React; // Shared host React instance: external bundles can't resolve bare imports, so they build host-tree components with `ctx.react.createElement`; the plugin's own sub…
ctx.documentStorage: DocumentStorage; // Isolated CAS text storage rooted under plugin-data/<plugin-id>.
ctx.assets: PluginAssets;
```

## Permission catalog

`manifest.permissions` only accepts the base permissions listed below, or well-formed `network:` / `exec:` grants; calling an undeclared capability throws, and an unknown permission means outright rejection at install/load time.

| Permission | Gated entry point |
|---|---|
| `storage` | `ctx.storage.get`、`ctx.storage.set`、`ctx.storage.delete` |
| `ui:settings-section` | `ctx.ui.registerSettingsSection`、`ctx.ui.openSettings` |
| `ui:add-menu` | `ctx.ui.registerAddMenuRow` |
| `ui:composer-status` | `ctx.ui.registerComposerSlot`、`ctx.ui.registerComposerStatusItem` |
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
| `ui:center-tab` | `ctx.ui.registerCenterTab`、`ctx.ui.openCenterTab` |
| `ui:conversation-mode` | `ctx.ui.registerConversationMode` |
| `agent` | `ctx.agent.catalog`、`ctx.agent.start`、`ctx.agent.interrupt` |
| `theme` | `ctx.theme.injectCss`、`ctx.theme.setTokens` |
| `i18n` | `ctx.i18n.addBundle` |
| `events` | `ctx.events.on`、`ctx.events.emit` |
| `network:none` | — |
| `composer:draft` | `ctx.composer.setDraft` |
| `host:session` | `ctx.sessions.selectSession`、`ctx.sessions.refresh`、`ctx.sessions.setEffort`、`ctx.sessions.startRun`、`ctx.sessions.interruptRun`、`ctx.sessions.registerSource` |
| `host:workspace` | `ctx.workspaces.add`、`ctx.workspaces.list` |
| `host:workspace:remote` | `ctx.workspaces.add` |
| `host:worktree` | `ctx.worktrees.create`、`ctx.worktrees.remove` |
| `host:window` | `ctx.window.getState`、`ctx.window.setNormalBounds`、`ctx.window.sampleWechat` |
| `host:models` | `ctx.models.listEngines`、`ctx.models.listEngineModels`、`ctx.models.catalog` |
| `session.lifecycle.read` | `ctx.hooks.registerSessionHooks` |
| `runtime.events.read` | `ctx.hooks.registerTurnHooks` |
| `runtime.switch.observe` | `ctx.hooks.registerRuntimeSwitchHooks` |
| `prompt.contribute.internal` | `ctx.hooks.registerTurnHooks` |
| `workspace.metadata.read` | `ctx.workspace.getMetadata` |
| `plugin.storage` | `ctx.documentStorage.getLocation`、`ctx.documentStorage.selectLocation`、`ctx.documentStorage.readText`、`ctx.documentStorage.writeTextAtomic`、`ctx.documentStorage.remove`、`ctx.documentStorage.list`、`ctx.assets.documentUrl` |
| `assets:bundle` | `ctx.assets.bundleUrl` |
| `assets:directory` | `ctx.assets.grantDirectory`、`ctx.assets.listDirectories`、`ctx.assets.revokeDirectory`、`ctx.assets.directoryUrl` |

### network: / exec: grant shapes

- `network:<host>` (any port) / `network:<host>:<port>` / `network:<host>:<a>-<b>` (endpoints inclusive, 1–65535). The host must match exactly (case-insensitive, no wildcards, subdomains do not match), http/https only.Valid examples: `network:127.0.0.1`, `network:api.example.com`, `network:EXAMPLE.com`, `network:api.example.com:8443`.
- `exec:<bin>`: a bare binary name (`^[A-Za-z0-9._-]+$`, no path separators), matched exactly, case-sensitive.
- `network:none` is a base permission meaning "this plugin uses no network" — it is **not** a grant and never allows any host.
- Network access and execution only go through the `ctx.bridge.invoke` command table (extracted from the host implementation below; any unlisted command name is rejected):

| bridge command | Required grant |
|---|---|
| `plugin_http_request` | `network:<host>` grant |
| `plugin_exec_run`、`plugin_exec_spawn` | `exec:<bin>` grant |
| `plugin_exec_kill` | any `exec:` grant |
| `plugin_agent_start`、`plugin_agent_interrupt` | `agent` |