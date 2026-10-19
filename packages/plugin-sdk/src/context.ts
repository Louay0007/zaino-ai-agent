import type { ComponentType } from "react";
import type * as React from "react";
import type { Disposer } from "./manifest";
import type { ComposerSlotId, SessionMenuTarget, WorkspaceMenuLabelValue } from "./registry";
export interface WorkspaceMetadata {
  id: string;
  path: string;
  gitBranch?: string;
  gitHead?: string;
  dirty?: boolean;
}

export interface PromptContribution {
  id: string;
  content: string;
  placement: "system-tail" | "request-tail";
  visibility: "internal";
  persistence: "turn" | "session";
  /** Called synchronously by the host exactly once after the engine accepts a
   * launch carrying this contribution. It is not called when launch fails or
   * when the byte budget rejects the contribution. Callback failures are
   * isolated and do not fail the accepted launch. Admitted contributions are
   * confirmed before afterTurn, even if the terminal event arrives first. */
  onAccepted?: () => void;
}

/** Optional text-frame capture for runtimes without a structured internal
 * message channel. The nonce correlates a frame to this turn; it is not an
 * authentication mechanism, and delivered payloads remain untrusted. */
export interface InternalMessageCapture {
  channel: string;
  nonce?: string;
  maxBytes: number;
  /** Synchronous predicate the host calls on each candidate frame's parsed
   *  payload, inline while parsing. Return true to let the host hide the frame
   *  from the transcript and deliver it to the plugin; returning false (or
   *  throwing) keeps the frame visible. NOT authoritative — the payload is
   *  still untrusted, so the plugin must validate again in
   *  `onInternalMessage`. Must be synchronous: it gates visibility before the
   *  async delivery can run. */
  validate?: (payload: unknown) => boolean;
}

export interface BeforeTurnResult {
  promptContributions?: PromptContribution[];
  internalMessageCapture?: InternalMessageCapture;
  /** Pure synchronous lifetime guard, checked during collection, replay,
   * launch acceptance, and capture parsing/delivery. False or throwing retires
   * this result's prompts and capture; a retired lifetime must not revive. */
  isCurrent?: () => boolean;
}

interface SessionEventBase {
  engine: string;
  sessionId: string | null;
  workspace: WorkspaceMetadata;
  occurredAt: string;
}

export interface SessionCreatedEvent extends SessionEventBase {}

export interface SessionRestoredEvent extends SessionEventBase {
  sessionId: string;
}

export interface SessionClosedEvent extends SessionEventBase {}

interface TurnEventBase {
  runId: string;
  turnId: string;
  engine: string;
  sessionId: string | null;
  workspace: WorkspaceMetadata;
  occurredAt: string;
}

export interface BeforeTurnEvent extends TurnEventBase {}

export interface AfterTurnEvent extends TurnEventBase {
  status: "completed" | "cancelled" | "failed";
  error?: string;
}

export interface InternalMessageEvent extends TurnEventBase {
  channel: string;
  nonce?: string;
  payload: unknown;
}

export interface RuntimeSwitchEvent {
  /** Stable identity shared by beforeSwitch and afterSwitch for one launch. */
  switchId: string;
  sourceEngine: string;
  targetEngine: string;
  sourceSessionId: string | null;
  targetSessionId: string | null;
  workspace: WorkspaceMetadata;
  occurredAt: string;
}

interface NormalizedRuntimeEventBase {
  eventId: string;
  runId: string;
  turnId: string;
  engine: string;
  sessionId: string | null;
  workspaceId: string;
  workspacePath: string;
  occurredAt: string;
}

export interface FileChangedEvent extends NormalizedRuntimeEventBase {
  kind: "file-changed";
  path: string;
   /** `touched` (the weakest fact the adapter can determine): the engine reported a
    *  mutating tool call against this path; it makes no claim about create, edit, or
    *  delete. */
  change: "created" | "modified" | "deleted" | "touched";
}

  /** The engine has started the command: this event carries no result and the exit
   *  code is unknown; the result is declared by the same tool row's
   *  command-finished event. */
export interface CommandStartedEvent extends NormalizedRuntimeEventBase {
  kind: "command-started";
  command: string;
  cwd: string;
  startedAt: string;
}

export interface CommandFinishedEvent extends NormalizedRuntimeEventBase {
  kind: "command-finished";
  command: string;
  cwd: string;
   /** Only set when the engine supplied a structured numeric exit code in the same
    *  tool message; null means the result has no exit code and status is unknown. */
  exitCode: number | null;
  startedAt?: string;
  finishedAt: string;
  status: "completed" | "failed" | "cancelled" | "unknown";
}

export interface ToolFinishedEvent extends NormalizedRuntimeEventBase {
  kind: "tool-finished";
  toolName: string;
  status: "completed" | "failed" | "cancelled" | "unknown";
}

/** The engine reported a denied capability and the host can present an
 * approval card. This does not assert that the engine is paused. */
export interface PermissionRequestedEvent extends NormalizedRuntimeEventBase {
  kind: "permission-requested";
  tool: string | null;
  path: string | null;
}

export interface AssistantCompletedEvent extends NormalizedRuntimeEventBase {
  kind: "assistant-completed";
}

export interface TurnCancelledEvent extends NormalizedRuntimeEventBase {
  kind: "turn-cancelled";
}

export interface TurnFailedEvent extends NormalizedRuntimeEventBase {
  kind: "turn-failed";
  error?: string;
}

export interface RuntimeExitedEvent extends NormalizedRuntimeEventBase {
  kind: "runtime-exited";
  exitCode: number | null;
}

export type NormalizedRuntimeEvent =
  | FileChangedEvent
  | CommandStartedEvent
  | CommandFinishedEvent
  | ToolFinishedEvent
  | PermissionRequestedEvent
  | AssistantCompletedEvent
  | TurnCancelledEvent
  | TurnFailedEvent
  | RuntimeExitedEvent;

export interface SessionHooks {
  onCreated?(event: SessionCreatedEvent): void | Promise<void>;
  onRestored?(event: SessionRestoredEvent): void | Promise<void>;
  onClosed?(event: SessionClosedEvent): void | Promise<void>;
}

export interface TurnHooks {
  beforeTurn?(event: BeforeTurnEvent): BeforeTurnResult | void | Promise<BeforeTurnResult | void>;
  /** Read-only launch observation; requires runtime.events.read, not prompt
   * contribution permission. Correlate start and finish using turnId. */
  onTurnStarted?(event: BeforeTurnEvent): void | Promise<void>;
  onRuntimeEvent?(event: NormalizedRuntimeEvent): void;
  afterTurn?(event: AfterTurnEvent): void | Promise<void>;
  onInternalMessage?(event: InternalMessageEvent): void | Promise<void>;
}

export interface RuntimeSwitchHooks {
  beforeSwitch?(event: RuntimeSwitchEvent): void | Promise<void>;
  afterSwitch?(event: RuntimeSwitchEvent): void | Promise<void>;
}

export type DocumentStorageLocationKind = "data" | "program" | "custom";

export interface ResolvedDocumentStorageLocation {
  kind: DocumentStorageLocationKind;
  path: string;
}

export interface DocumentReadResult {
  content: string;
  /** Opaque compare-and-swap token. */
  version: string;
}

export interface DocumentWriteResult {
  /** Opaque token to use as expectedVersion for the next write. */
  version: string;
}

export interface DocumentStorage {
  getLocation(): Promise<ResolvedDocumentStorageLocation>;
  /** Selecting custom opens the host directory picker. */
  selectLocation(kind: DocumentStorageLocationKind): Promise<ResolvedDocumentStorageLocation>;
  readText(relativePath: string): Promise<DocumentReadResult | null>;
  /** expectedVersion=null requires the document not to exist. */
  writeTextAtomic(
    relativePath: string,
    content: string,
    expectedVersion: string | null,
  ): Promise<DocumentWriteResult>;
  /** Delete a document. Pass the opaque version from the last read to make
   *  the delete conditional (CAS); omit it (or pass null) to delete
   *  unconditionally. A stale version rejects with a conflict and leaves the
   *  newer document in place. */
  remove(relativePath: string, expectedVersion?: string | null): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface AssetDirectoryGrant {
  grantId: string;
  /** Canonical host filesystem path, for display and revealPath. */
  path: string;
}

export interface PluginAssets {
  /** Bundled resource URL; requires assets:bundle. */
  bundleUrl(relativePath: string): string;
  /** Resource under the current documentStorage root; requires plugin.storage. */
  documentUrl(relativePath: string): string;
  /** Proxied HTTP(S) URL; requires an exact network:<host> grant. Relative
   * resources remain proxied. Embedded URL credentials are not accepted. */
  remoteUrl(url: string): string;
  /** Call from a user action, never activation: opens the host directory
   * chooser. Cancellation rejects. Requires assets:directory. */
  grantDirectory(): Promise<AssetDirectoryGrant>;
  listDirectories(): Promise<AssetDirectoryGrant[]>;
  revokeDirectory(grantId: string): Promise<void>;
  /** Resource in a directory granted to this plugin; requires assets:directory.
   * Paths use forward slashes and are relative to the directory root. */
  directoryUrl(grantId: string, relativePath: string): string;
}


/**
 * PluginContext (plan §5.2): the plugin's only capability facade. The host's
 * runtime/context.ts implements this interface; the plugin-side type mirror lives
 * in the package root plugin.d.ts (bidirectional drift is guarded at the type
 * level by contract-check.ts).
 */

/** An external session source row (ctx.sessions.registerSource, since 0.3.4): a
 *  remote / in-container session summary reported by a plugin. workspacePath must
 *  be the path of an already-registered workspace, otherwise the host drops the
 *  row when merging (the sidebar groups by workspacePath). */
export interface ExternalSessionRow {
  engine: string;
  sessionId: string;
  workspacePath: string;
  title?: string;
  updatedAt?: number | null;
   /** The absolute path of the remote jsonl (optional; the host pulls history replay through the remote channel). */
  remotePath?: string;
}

export type PluginConversationProps = {
  conversationId: string;
  workspacePath: string;
  language: string;
  onExit: () => void;
  setExitBlocked?: (blocked: boolean) => void;
};

export interface PluginAgentCatalogEntry {
  engine: string;
  label: string;
  available: boolean;
  readOnly: boolean;
  providers: { id: string; label: string }[];
   /** The models currently available on the engine. `provider` is the id of the
    *  channel the model belongs to (aligned with `providers[].id`, since 0.3.18),
    *  so plugins can group by it; `label` is already a display name. */
  models: { id: string; label: string; provider?: string }[];
   /** The reasoning-effort levels this engine supports (slider order; an empty array means not configurable). */
  efforts: string[];
}

 /** A sidebar workspace row (from `ctx.workspaces.list()`). Deliberately excludes
 *  `meta`: that is a private payload written by the host and other plugins, and the
 *  read surface only exposes what display and path resolution need. */
export interface PluginWorkspaceRow {
  id: string;
   /** An absolute local path (remote/WSL workspace paths don't exist locally, but the string still works as-is). */
  path: string;
   /** The sidebar display name (the directory name, or the name the user renamed it to). */
  name: string;
   /** "worktree" = a git worktree child row; undefined = an ordinary workspace. */
  kind?: "worktree";
   /** The sidebar group id; null = ungrouped. */
  groupId: string | null;
   /** The parent workspace id; present only when kind="worktree". */
  parentId?: string;
   /** Last opened time (Unix ms); null when never opened. */
  lastOpenedAt: number | null;
   /** The read-only projection of a worktree child row (since 0.3.17): the branch name and
    *  originating PR number. Present when `kind` is "worktree"; other private payload in
    *  `meta` (such as wsl) still does not come through. */
  worktree?: { branch: string; prNumber?: number };
}

export interface PluginWindowBounds {
  /** Physical desktop coordinates; may be negative on left/top monitors. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PluginWindowSnapshot {
  bounds: PluginWindowBounds;
  state: "normal" | "minimized" | "maximized" | "fullscreen";
  scaleFactor: number;
}

export interface PluginWechatWindow {
  bounds: PluginWindowBounds;
  executable: "Weixin.exe" | "WeChat.exe";
}

export interface PluginEngineInfo {
  id: string;
  available: boolean;
  enabled: boolean;
  supportsImages: boolean;
  supportsComputerUse: boolean;
  supportsEffort: boolean;
  supportsToolConstraints: boolean;
  permissions: string[];
}

export interface PluginEngineModel {
  id: string;
  name?: string | null;
  description?: string | null;
  provider: string;
  contextWindow?: number | null;
}

export interface PluginEngineCatalog {
  models: PluginEngineModel[];
  authoritative: boolean;
  remote?: boolean;
}

export interface PluginEngineCatalogEntry {
  engine: PluginEngineInfo;
  catalog: PluginEngineCatalog;
}

export interface PluginModelCatalogResult {
  engines: PluginModelCatalogEngine[];
  errors: PluginModelCatalogError[];
  refreshedAt: number;
}
export interface PluginModelCatalogEngine {
  engine: PluginEngineInfo;
  sources: PluginModelSource[];
}
export interface PluginModelSource {
  id: string;
  name: string;
  kind: "cli" | "official" | "provider" | "custom" | "configured" | "builtin";
  authoritative: boolean;
  remote: boolean;
  models: PluginEngineModel[];
  refreshedAt: number;
  detail?: string;
}
export interface PluginModelCatalogError {
  engine: string;
  sourceId?: string;
  message: string;
}

export interface PluginContext {
  pluginId: string;
  version: string;
  /** Shared host React instance: external bundles can't resolve bare
   *  imports, so they build host-tree components with
    *  `ctx.react.createElement`; the plugin's own subtree is mounted with its bundled
    *  React createRoot into the ctx.react container (two-stage mount; import-map sharing
    *  is a later follow-up). */
  react: typeof React;
  hooks: {
    registerSessionHooks(hooks: SessionHooks): Disposer;
    registerTurnHooks(hooks: TurnHooks): Disposer;
    registerRuntimeSwitchHooks(hooks: RuntimeSwitchHooks): Disposer;
  };
  workspace: {
    /** Stable host-registered workspace identity for the active path. */
    getMetadata(): Promise<WorkspaceMetadata>;
  };
  /** Isolated CAS text storage rooted under plugin-data/<plugin-id>. */
  documentStorage: DocumentStorage;
  assets: PluginAssets;
  shell: {
    /** Reveal an existing path inside this plugin's documentStorage root or
     * an explicitly granted resource directory. No arbitrary open/execute. */
    revealPath(path: string): Promise<void>;
  };
  ui: {
    registerConversationMode(def: {
      key?: string;
      label: () => string;
      component: ComponentType<PluginConversationProps>;
    }): Disposer;
    registerSettingsSection(def: {
      /** Optional sub-key; the settings page key becomes
       *  `plugin:<id>` or `plugin:<id>:<key>`. */
      key?: string;
      label: () => string;
      icon?: ComponentType<{ className?: string }>;
      component: ComponentType;
    }): Disposer;
    registerAddMenuRow(def: {
      key?: string;
      label: () => string;
      description?: () => string;
      icon?: ComponentType<{ className?: string }>;
      onSelect: () => void;
    }): Disposer;
    /** Extra control rendered beside a composer slot's builtin control
     *  (plan §4.2 #2). Permission `ui:composer-status` (shared with
     *  registerComposerStatusItem — both gate on the same composer-area
     *  grant; there is no separate `ui:composer` permission). */
    registerComposerSlot(def: {
      slot: ComposerSlotId;
      key?: string;
      component: ComponentType;
      order?: number;
    }): Disposer;
    /** Chat right-panel tab (plan §4.2 #4); renders with the active
     *  workspace path. The strip renders plugin tabs icon-only, so `icon` is
     *  the visible identity — without one the tab falls back to the plugin's
     *  artwork / letter tile, and the label stays a title/accessible name. */
    registerPanelTab(def: {
      key?: string;
      label: () => string;
      icon?: ComponentType<{ className?: string }>;
      component: ComponentType<{ workspacePath: string }>;
      order?: number;
    }): Disposer;
    /** App status-bar chip (plan §4.2 #8). */
    registerStatusBarItem(def: {
      key?: string;
      component: ComponentType;
      order?: number;
      /** Placement zone (0.3.8): "start" = left-aligned zone; omitted/"end"
       *  = legacy slot after sync status, before version. */
      zone?: "start" | "end";
    }): Disposer;
    /** Composer status-row chip (permission `ui:composer-status`, 0.3.9):
     *  renders in the composer's status row (branch/context meter row),
     *  left group after the branch switcher. */
    registerComposerStatusItem(def: {
      key?: string;
      component: ComponentType;
      order?: number;
    }): Disposer;
    /** Persistent viewport mount; requires ui:overlay. The plugin controls
     * placement and opts interactive children into pointer-events: auto. */
    registerOverlay(def: {
      key?: string;
      component: ComponentType;
      order?: number;
    }): Disposer;
    /** Command palette entry (plan §4.2 #9). */
    registerCommand(def: {
      key: string;
      title: () => string;
      keywords?: () => string[];
      run: () => void;
    }): Disposer;
    /** Sidebar session right-click menu row (permission `ui:session-menu`,
     *  since 0.3.5). `run` receives the session whose menu was opened: `{ engine, sessionId }`. */
    registerSessionMenuItem(def: {
      key?: string;
      label: () => string;
      icon?: ComponentType<{ className?: string }>;
      danger?: boolean;
      run: (target: SessionMenuTarget) => void;
    }): Disposer;
     /** Jump to this plugin's settings page (permission `ui:settings-section`, since 0.3.6).
      *  `key` matches a sub-key of registerSettingsSection; omit it to open the main
      *  section. For deep links from status-bar chips, panel buttons, and the like. */
    openSettings(key?: string): void;
    /** Markdown pipeline additions, merged over host defaults (plan §4.2 #5). */
    registerMarkdownRenderer(def: {
      key?: string;
      remarkPlugins?: unknown[];
      rehypePlugins?: unknown[];
      components?: Record<string, unknown>;
    }): Disposer;
    /** Overlay page at `#/p/<id>` (plan §4.2 #10). */
    registerPage(def: {
      key?: string;
      title: () => string;
      component: ComponentType;
    }): Disposer;
        /** Renderer for a plugin-defined chat timeline row kind (plan §4.2 #5).
     * The row payload is plugin-defined and typed loosely — blob bundles
     * can't share the host's TimelineRow type identity. */
    registerTimelineRowRenderer(def: {
      kind: string;
      key?: string;
      component: ComponentType<{ row: { kind: string } }>;
    }): Disposer;
    /** Sidebar workspace row context-menu entry. */
    registerWorkspaceMenuItem(def: {
      key?: string;
      label: (ctx: { workspaceId: string; archived: boolean }) => WorkspaceMenuLabelValue;
      icon?: ComponentType<{ className?: string }>;
      visible?: (ctx: { workspaceId: string; archived: boolean }) => boolean;
      onSelect: (ctx: { workspaceId: string; archived: boolean }) => void;
      order?: number;
    }): Disposer;
     /** Home sidebar nav entry under the builtin Mission Workbench row (permission
     *  `ui:sidebar-entry`, 0.3.12). `onOpen` usually opens the plugin's
     *  center tab via openCenterTab. */
    registerSidebarNav(def: {
      key?: string;
      label: () => string;
      icon?: ComponentType<{ className?: string }>;
      order?: number;
      onOpen: () => void;
    }): Disposer;
    /** Center-area tab definition (permission `ui:center-tab`, 0.3.12):
     *  renders in the center tab strip like session/file/browser tabs.
     *  Opening goes through openCenterTab; multiple keys = multiple tabs. */
    registerCenterTab(def: {
      key?: string;
      title: () => string;
      icon?: ComponentType<{ className?: string }>;
      component: ComponentType;
      order?: number;
    }): Disposer;
    /** Open (or focus) one of this plugin's registered center tabs
     *  (permission `ui:center-tab`, 0.3.12). Throws when the tab was never
     *  registered — open failures must be visible, not silent. */
    openCenterTab(key?: string): void;
  };
  theme: {
    /** Inject a stylesheet scoped to this plugin; removed on unload.
     *  Rejects remote references (`@import`, `url(http…)`): plugins must be
     *  self-contained (plan §8 gate rules). */
    injectCss(css: string): Disposer;
    /** Shorthand for BoardUI token overrides: keys must be `--*` custom
     *  properties; emits `:root {…}` and `.dark {…}` blocks. */
    setTokens(tokens: { light?: Record<string, string>; dark?: Record<string, string> }): Disposer;
  };
  i18n: {
    addBundle(lang: string, ns: string, resources: Record<string, unknown>): Disposer;
  };
  storage: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  events: {
    on(topic: string, cb: (data: unknown) => void): Disposer;
    emit(topic: string, data: unknown): void;
  };
   /** Composer draft write (permission `composer:draft`, since 0.3.2).
    *  Writing replaces the draft of the currently active session; it never sends —
    *  sending is always a user action. */
  composer: {
    setDraft(text: string): void;
  };
   /** Workspace registration and reads (permission `host:workspace`, since 0.3.3;
   *  `list` since 0.3.16). Register an arbitrary path as a sidebar workspace — the
   *  directory need not exist locally (e.g. a path inside an ssh-managed remote
   *  machine or WSL distribution). `meta` passes through onto the host workspace
   *  row; its shape is agreed between writer and consumer.
   *
   *  `list` returns the sidebar's current workspace rows (including worktree child
   *  rows, distinguished by `kind`). It is a **read-only snapshot**: no `meta`
   *  (the private payload written by remote/other plugins) and no group definitions,
   *  only what a plugin needs to resolve repositories/paths per local workspace. Call
   *  it again to follow host changes; the host broadcasts no workspace change events
   *  to plugins.
   *
   *  A `meta` carrying a `wsl` key (a remote workspace, where the host engine tunnels
   *  session traffic over ssh to the host and distribution named by meta.wsl) needs the
   *  extra permission `host:workspace:remote` (since 0.3.4) — that is effectively
   *  network egress plus remote execution, far beyond registering one sidebar row.
   *  Trust tradeoff: the remote channel's first connection uses
   *  StrictHostKeyChecking=accept-new (the host key is recorded on first connect and
   *  only later changes are rejected), so plugin authors should know this is TOFU
   *  rather than strict pinning. */
  workspaces: {
    add(path: string, meta?: Record<string, unknown>): Promise<void>;
     /** A sidebar workspace snapshot (read-only; permission `host:workspace`, since 0.3.16).
      *  Worktree child rows additionally carry a read-only
      *  `worktree: { branch, prNumber? }` projection (since 0.3.17), which binds a PR
      *  to a local worktree; field definitions live in `PluginWorkspaceRow`, and
      *  `meta` itself is still not returned. */
    list(): Promise<PluginWorkspaceRow[]>;
  };
   /** Worktree creation (permission `host:worktree`, since 0.3.17): created through
   *  the host's "New Worktree" pipeline (validate → fetch → add → register), with the
   *  same progress row and cancel/retry semantics in the host sidebar; on success the
   *  worktree is registered in the sidebar with `kind="worktree"` (its parent row is
   *  the workspace named by `parentWorkspaceId`), and resolves with the registered
   *  path.
   *
   *  When `prNumber` is present it fetches `pull/<n>/head` before checking out;
   *  `existingBranch` means `branch` is an existing local branch (check out, not
   *  create). The default path is the host's default layout
   *  `<sibling of repo>/<repo name>-worktrees/<branch>`.
   *
   *  Failure/cancel rejects with an `Error` whose message is `"<errorKind>: <detail>"`
   *  (the kind matches the host's error classification: not_a_repo / invalid_branch /
   *  branch_not_found / branch_exists / branch_checked_out / dir_exists /
   *  pr_not_found / fetch_failed / register_failed / sparse_checkout_empty /
   *  canceled / unknown), so plugins can render readable text. */
  worktrees: {
    create(def: {
       /** The local repository path (the parent workspace directory; must be a git repo). */
      repoPath: string;
       /** The parent workspace id: the new worktree hangs under it as a child row. */
      parentWorkspaceId: string;
       /** The branch name checked out in the new worktree. */
      branch: string;
       /** Where a new branch starts from; default = the repo HEAD. */
      baseRef?: string | null;
       /** Create from a PR: fetch `pull/<n>/head` into `branch`. */
      prNumber?: number | null;
      prTitle?: string | null;
      prUrl?: string | null;
       /** true = `branch` is an existing local branch (check out, not create). */
      existingBranch?: boolean;
    }): Promise<{ worktreePath: string }>;
     /** Remove a local worktree (permission `host:worktree`, since 0.3.19): goes
      *  through the host sidebar's delete flow — `git worktree remove` (optionally
      *  deleting the branch) plus deregistering the sidebar/terminal entries. A
      *  rejection message looks like "<errorKind>: <detail>" (errorKind uses the same
      *  classification as creation, plus not_found / remove_failed). It resolves with
      *  non-fatal tails: `orphanDirectory` (the directory could not be removed) and
      *  `branchKeptReason` ("checked_out_elsewhere" | "unknown"; null = the branch was
      *  deleted or deletion was not requested). */
    remove(def: {
      repoPath: string;
      worktreePath: string;
      branch?: string | null;
      deleteBranch?: boolean;
    }): Promise<{ orphanDirectory: boolean; branchKeptReason: string | null }>;
  };
   /** Session opening + external session sources (permission `host:session`;
   *  selectSession since 0.3.3, registerSource since 0.3.4). registerSource registers an
   *  async session source; the host calls `list()` on every session directory refresh
   *  (init/refreshSessions/rescan) and merges the rows into the sidebar list — local
   *  scan results win, and external rows with the same
   *  engine/sessionId/workspacePath are dropped. Returns a Disposer that
   *  auto-deregisters on unload. */
  sessions: {
    selectSession(engine: string, sessionId: string, workspacePath: string): Promise<void>;
     /** Ask the host to refresh the session directory (sidebar/tabs) now, since 0.3.7.
      *  Call this after writing session data behind the host's back (e.g. a sqlite
      *  custom_title, a transcript title row) — otherwise the change stays invisible
      *  until the user syncs manually or the next regular refresh. */
    refresh(): Promise<void>;
     /** Change an existing session's effort level, since 0.3.10. Writes host session
      *  state directly and persists it (equivalent to the user switching levels in the
      *  session; refreshSessions will not roll it back). An unknown session or an
      *  empty effort fails with a rejection — no ghost session entry is created. */
    setEffort(engine: string, sessionId: string, workspacePath: string, effort: string): Promise<void>;
     /** Run an AI turn as a **host chat session** (since 0.3.18, permission
      *  `host:session`): the session appears in the sidebar immediately (with running
      *  state, no manual sync needed) and opens onto a live stream; it can be stopped
      *  from the chat or via `interruptRun`. The session hangs under the
      *  `workspacePath` workspace, and the model/effort/channel override applies to
      *  this turn only, leaving the user's global defaults untouched.
      *
      *  How it differs from `ctx.agent.start`: that one is the plugin's own background
      *  turn (events go only to the plugin, never into chat); this one is "as if the
      *  user sent a message". Use this method for turns the user should see and can
      *  take over or stop at any time.
      *
      *  After a successful spawn it resolves with `{ runId, sessionId }` (sessionId is
      *  null when the engine announces it later); termination is reported back over
      *  the `plugin-run://<pluginId>` event channel, and turns interrupted by the user
      *  or the plugin still finish with `done`. */
    startRun(def: {
      engine: string;
      prompt: string;
       /** The workspace path the session belongs to (e.g. a worktree). */
      workspacePath: string;
       /** The model id for this turn (a `models[].id` from `ctx.agent.catalog`). */
      model?: string | null;
       /** The reasoning effort for this turn (one level from the catalog's `efforts`). */
      effort?: string | null;
       /** The channel id for this turn (a `providers[].id` from the catalog). */
      providerId?: string | null;
    }): Promise<{ runId: string; sessionId: string | null }>;
     /** Stop a turn started by `startRun` (equivalent to the chat's stop button). */
    interruptRun(def: {
      engine: string;
      workspacePath: string;
      sessionId?: string | null;
    }): Promise<void>;
    registerSource(def: {
       /** The source id, unique within the plugin; re-registering the same id overwrites it (hot-reload semantics). */
      id: string;
      list: () => Promise<ExternalSessionRow[]>;
    }): Disposer;
  };
   /** Main window access (permission `host:window`, since 0.3.19). Coordinates and
   *  sizes are in physical pixels; setNormalBounds only accepts a normal-state window and
   *  requires at least 64x64 pixels to fall on one of the current screens. sampleWechat
   *  samples by executable name Weixin.exe/WeChat.exe on Windows; other platforms reject
   *  with Unsupported, and a not-found executable rejects with NotFound. */
  window: {
    getState(): Promise<PluginWindowSnapshot>;
    setNormalBounds(bounds: PluginWindowBounds): Promise<PluginWindowSnapshot>;
    sampleWechat(): Promise<PluginWechatWindow>;
  };
   /** The host model catalog (permission `host:models`, since 0.3.19). Results come from
   *  the host's authoritative list_engines/list_engine_models and contain no API keys,
   *  tokens, or full provider config. workspace is optional; remote workspaces are
   *  probed from the remote host/WSL side that owns the CLI. */
  models: {
    listEngines(): Promise<PluginEngineInfo[]>;
    listEngineModels(engine: string, workspace?: string): Promise<PluginEngineCatalog>;
    /** Aggregated safe catalog. Provider endpoints are contacted only when
     *  refreshProviders is true (must be tied to an explicit user action). */
    catalog(options?: {
      workspace?: string;
      refreshProviders?: boolean;
    }): Promise<PluginModelCatalogResult>;
  };
   /** Agent turns (permission `agent`, since 0.3.13): starts an agent process through
   *  the host engine pipeline — structurally the same as channel injection, process
   *  registration, and a chat send. Events travel on a dedicated
   *  `agent://<pluginId>` bus topic (subscribe via ctx.events.on; the payload is the
   *  engine event envelope { runId, sessionId, engine, seq, kind, data, ts }, with
   *  kind ∈ delta | tool | usage | done | error …). Desktop only (plugins that are
   *  unavailable under isWeb must present themselves). */
  agent: {
    catalog(workspacePath: string): Promise<PluginAgentCatalogEntry[]>;
     /** Start an agent turn; the returned runId is used for event filtering and interrupt. */
    start(def: {
      engine: string;
      prompt: string;
       /** The agent process's working directory (an absolute path). */
      workspacePath: string;
      model?: string;
       /** Default = the engine's current channel (resolved exactly like a chat send). */
      providerId?: string;
       /** An engine-specific session continuation id (e.g. pi's --session-id): the same id continues the previous turn. */
      sessionId?: string;
      readOnly?: boolean;
      requestId?: string;
    }): Promise<{ runId: string; sessionId: string | null }>;
     /** Interrupt a run this plugin started (the run id's owner prefix is enforced by the host). */
    interrupt(runId: string): Promise<boolean>;
  };
   /** The general capability outlet (since 0.3.0; the old per-command `cmd:<command>`
   *  authorization mechanism was removed). Only the commands below are available, and
   *  `pluginId` is injected by the host (the plugin neither needs to nor may pass it):
   *
   *  - `plugin_http_request` `{ method, url, headers?, body? }` →
   *    `{ status, body }`: the url is restricted to http/https, and the host (plus port)
   *    must match the manifest's
   *    `network:<host>` / `network:<host>:<port>` / `network:<host>:<a>-<b>` grant
   *    (shapes and allow rules live in spec/permissions.json).
   *  - `plugin_exec_run` `{ bin, args, env?, timeoutMs? }` →
   *    `{ code, stdout, stderr }`: bin must match an `exec:<bin>` grant (bare name, no
   *    path). The child process PATH is injected by the host as "the plugin env's PATH
   *    (if any, keeping priority) + the host's CLI search directories (the process PATH
   *    plus common install locations)", so `#!/usr/bin/env node`-style shims find their
   *    interpreter; a plugin cannot fully lock PATH down through env.
   *  - `plugin_exec_spawn` `{ bin, args, env?, lifecycle? }` → void:
   *    the same grant requirement; resolves to void on success (Rust returns ()), rejects
   *    on failure. PATH injection matches `plugin_exec_run`.
   *    lifecycle defaults to "detached" (a user-level service that outlives the
   *    plugin); "plugin" = a child process the host tracks and kills automatically when
   *    the plugin is disabled or uninstalled.
   *  - `plugin_exec_kill` `{}` → `{ killed: number }`: kills every lifecycle="plugin"
   *    child of this plugin (a config change renames it to re-enable; any exec: grant
   *    required).
   *  - `plugin_agent_start` / `plugin_agent_interrupt` (since 0.3.13):
   *    the same capability as `ctx.agent` (requires the `agent` permission) — the host
   *    takes over the engine pipeline and enforces the run id owner prefix in Rust.
   *
   *  A call whose grant does not match is rejected on the JS side (no IPC round trip);
   *  Rust separately enforces grants and plugin enabled-state (defense in depth). */
  bridge: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  host: {
    appVersion: string;
     /** The SDK contract version the host implements (= this package's version), for plugin runtime self-checks. */
    sdkVersion: string;
    locale: string;
    /** True in the web-access browser client; the desktop-only bridge
     *  commands above are absent there. */
    isWeb: boolean;
  };
}
