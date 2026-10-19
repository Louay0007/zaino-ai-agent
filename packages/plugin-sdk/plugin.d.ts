/**
 * @ccgui/plugin-sdk — the plugin-side public contract declarations (same pattern as VS
 * Code's vscode.d.ts: this file is the public API definition plugin authors see,
 * maintained in-package with src/ and released at the same version; bidirectional drift
 * is guarded at the type level by src/contract-check.ts).
 *
 * Plugin repo usage (the interim approach while the package is unpublished to npm):
 *  copy this file to the plugin repo's `src/ccgui-plugin.d.ts`; the version stamp on the
 *  first line must match the host SDK you build against.
 *
 * @ccgui/plugin-sdk v0.3.20
 */

/** The SDK contract version the host implements. */
export declare const SDK_VERSION: string;

/** The undo handle returned by each register*; executed in reverse order on unload. */
export type Disposer = () => void;

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
   /** The models currently available on the engine. provider is the id of the channel the
    *  model belongs to (aligned with providers[].id, since 0.3.18), so plugins can group
    *  by it; label is already a display name. */
  models: { id: string; label: string; provider?: string }[];
   /** The reasoning-effort levels this engine supports (slider order; an empty array means not configurable). */
  efforts: string[];
}

/** A sidebar workspace row (from ctx.workspaces.list()). Deliberately excludes meta:
 *  that is a private payload written by the host and other plugins, and the read surface
 *  only exposes what display and path resolution need. */
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
    *  originating PR number. Present when kind is "worktree"; other private payload in
    *  meta (such as wsl) still does not come through. */
  worktree?: { branch: string; prNumber?: number };
}

export interface PluginWindowBounds {
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

/** Trust tier (ADR-1): declarative = zero-JS declarative. */
export type PluginTier = "declarative" | "js";

/** The single plugin entry convention: main.js default-exports this function. */
export type PluginActivate = (ctx: PluginContext) => void | (() => void);
/** Validates safe lowercase point-separated plugin ids: 2..=64 bytes total,
 *  each segment `[a-z0-9][a-z0-9-]*`. Byte-for-byte identical to the Rust
 *  install-time check. */
export declare function isValidPluginId(id: string): boolean;


/** An external session source row (ctx.sessions.registerSource, since 0.3.4): a
 *  remote / in-container session summary reported by a plugin. workspacePath must be
 *  the path of an already-registered workspace, otherwise the host drops the row
 *  when merging (the sidebar groups by workspacePath). */
export interface ExternalSessionRow {
  engine: string;
  sessionId: string;
  workspacePath: string;
  title?: string;
  updatedAt?: number | null;
   /** The absolute path of the remote jsonl (optional; the host pulls history replay through the remote channel). */
  remotePath?: string;
}

export interface JsonSchemaProperty {
  type?: "string" | "number" | "integer" | "boolean";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: (string | number)[];
}

export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/** ccgui.plugin.json（plan §5.1）。 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
   /** The compatible SDK range: "^0.3" / "~0.3.0" / ">=0.3.0" / exact / "*" (default: no check). */
  sdkVersion?: string;
  author?: string;
  description?: string;
  tier: PluginTier;
   /** Base permissions and `network:<host>[…]` / `exec:<bin>` grants; the full set, shapes
    *  and allow rules live in the package's spec/permissions.json as the single source of
    *  truth (consumed by TS, Rust, and the template validation script alike).
    *  `network:none` is a base permission (declares no network), never a grant — it does
    *  not allow any host. */
  permissions: string[];
  contributes?: {
    themes?: { name?: string; tokens: { light?: Record<string, string>; dark?: Record<string, string> } }[];
    i18n?: { lang: string; ns?: string; resources: Record<string, unknown> }[];
    statusBarItems?: { key?: string; text: string }[];
    commands?: { key: string; title: string; emits?: string }[];
  };
  configSchema?: JsonSchemaObject;
   /** A square marketplace icon: a repo-relative path (recommended `docs/icon.png`) or an
    *  https URL; default = the marketplace renders a first-letter tile. Read only by the
    *  index — host installs do not read it. */
  icon?: string;
   /** Marketplace detail-page screenshots: a repo-relative path or an https URL, up to 5; default = no gallery rendered. */
  screenshots?: string[];
}

export type ComposerSlotId = "addMenu" | "cliMenu" | "permissionMenu";
export type WorkspaceMenuStatusTone = "success" | "muted";
export interface WorkspaceMenuLabel {
  text: string;
  status?: { text: string; tone: WorkspaceMenuStatusTone };
}
export type WorkspaceMenuLabelValue = string | WorkspaceMenuLabel;


/** The session row whose sidebar context menu was opened. */
export interface SessionMenuTarget {
  engine: string;
  sessionId: string;
}

export type ComponentLike<P = Record<string, never>> = (props: P) => unknown;
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
export interface SessionRestoredEvent extends SessionEventBase { sessionId: string }
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
/** A denied engine capability surfaced for host approval, not a promise
 * that the engine is paused. No user-facing message text is exposed. */
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
export interface DocumentReadResult { content: string; version: string }
export interface DocumentWriteResult { version: string }
export interface DocumentStorage {
  getLocation(): Promise<ResolvedDocumentStorageLocation>;
  selectLocation(kind: DocumentStorageLocationKind): Promise<ResolvedDocumentStorageLocation>;
  readText(relativePath: string): Promise<DocumentReadResult | null>;
  /** expectedVersion=null requires the document not to exist. */
  writeTextAtomic(
    relativePath: string,
    content: string,
    expectedVersion: string | null,
  ): Promise<DocumentWriteResult>;
  /** Delete a document. Pass the opaque version from the last read for a
   *  conditional (CAS) delete; omit/null deletes unconditionally. A stale
   *  version rejects with a conflict. */
  remove(relativePath: string, expectedVersion?: string | null): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface AssetDirectoryGrant {
  grantId: string;
  /** Canonical host filesystem path. */
  path: string;
}
export interface PluginAssets {
  /** assets:bundle permission. */
  bundleUrl(relativePath: string): string;
  /** plugin.storage permission; follows the selected document root. */
  documentUrl(relativePath: string): string;
  /** HTTP(S) proxy, exact network:<host> grant; no embedded credentials. */
  remoteUrl(url: string): string;
  /** User action only; assets:directory permission. Cancellation rejects. */
  grantDirectory(): Promise<AssetDirectoryGrant>;
  listDirectories(): Promise<AssetDirectoryGrant[]>;
  revokeDirectory(grantId: string): Promise<void>;
  /** Forward-slash relative path inside a directory granted to this plugin. */
  directoryUrl(grantId: string, relativePath: string): string;
}


  /** The plugin's only capability facade (plan §5.2). Every register* needs a matching
   *  permission declaration and returns a Disposer; even without explicit cleanup the
   *  host's disposer stack backstops it. */
export interface PluginContext {
  pluginId: string;
  version: string;
   /** The host's shared React: host tree container components are created through it
   *  (createElement/useRef/...); the plugin's own subtree is mounted with its own
   *  createRoot into the container (two-stage mount). */
  react: typeof import("react");
  hooks: {
    registerSessionHooks(hooks: SessionHooks): Disposer;
    registerTurnHooks(hooks: TurnHooks): Disposer;
    registerRuntimeSwitchHooks(hooks: RuntimeSwitchHooks): Disposer;
  };
  workspace: {
     /** A stable host-registered workspace identity (permission workspace.metadata.read). */
    getMetadata(): Promise<WorkspaceMetadata>;
  };
   /** Plugin-isolated CAS text document storage (permission plugin.storage). */
  documentStorage: DocumentStorage;
  assets: PluginAssets;
  shell: {
    /** Reveal only within this plugin's document root or granted directories. */
    revealPath(path: string): Promise<void>;
  };
  ui: {
    /** Persistent viewport mount (ui:overlay); interactive children must
     * explicitly opt into pointer-events: auto. Removed on plugin unload. */
    registerOverlay(def: {
      key?: string;
      component: ComponentLike;
      order?: number;
    }): Disposer;
    registerConversationMode(def: {
      key?: string;
      label: () => string;
      component: ComponentLike<PluginConversationProps>;
    }): Disposer;
     /** A settings page section (permission ui:settings-section). */
    registerSettingsSection(def: {
      key?: string;
      label: () => string;
      icon?: ComponentLike<{ className?: string }>;
      component: ComponentLike;
    }): Disposer;
     /** A Composer "Add" menu row (permission ui:add-menu). */
    registerAddMenuRow(def: {
      key?: string;
      label: () => string;
      description?: () => string;
      icon?: ComponentLike<{ className?: string }>;
      onSelect: () => void;
    }): Disposer;
     /** An extra control in the Composer toolbar slot (permission ui:composer-status; this
      *  historically also required the nonexistent `ui:composer`, so versions 1.0.4 and
      *  earlier rejected every declaration — spec/permissions.json has since converged
      *  both onto the same permission string). */
    registerComposerSlot(def: {
      slot: ComposerSlotId;
      key?: string;
      component: ComponentLike;
      order?: number;
    }): Disposer;
     /** A chat right-panel tab (permission ui:panel-tab). A plugin tab renders only
      *  an icon in the tab bar, so `icon` is what the user actually sees; when omitted it
      *  falls back to the plugin asset / first-letter tile, and `label` serves as the
      *  title and accessible name. */
    registerPanelTab(def: {
      key?: string;
      label: () => string;
      icon?: ComponentLike<{ className?: string }>;
      component: ComponentLike<{ workspacePath: string }>;
      order?: number;
    }): Disposer;
     /** An app bottom status-bar entry (permission ui:status-bar). */
    registerStatusBarItem(def: {
      key?: string;
      component: ComponentLike;
      order?: number;
       /** Placement region (since 0.3.8): "start" = the left-aligned region; omitted/"end" =
        *  the existing slot after the sync status and before the version number. */
      zone?: "start" | "end";
    }): Disposer;
     /** A Composer status-line entry (permission ui:composer-status, since 0.3.9): rendered
     *  in the left group of the input's status line (the branch / context-usage row), after
     *  the branch switcher. */
    registerComposerStatusItem(def: {
      key?: string;
      component: ComponentLike;
      order?: number;
    }): Disposer;
     /** A ⌘K command-palette command (permission ui:command). */
    registerCommand(def: {
      key: string;
      title: () => string;
      keywords?: () => string[];
      run: () => void;
    }): Disposer;
     /** An extra row in the sidebar session context menu (permission ui:session-menu, since
      *  0.3.5); run receives the session whose menu was opened. */
    registerSessionMenuItem(def: {
      key?: string;
      label: () => string;
      icon?: ComponentLike<{ className?: string }>;
      danger?: boolean;
      run: (target: SessionMenuTarget) => void;
    }): Disposer;
     /** Jump to this plugin's settings page (permission `ui:settings-section`, since 0.3.6).
      *  `key` matches a sub-key of registerSettingsSection; omit it to open the main
      *  section. For deep links from status-bar chips, panel buttons, and the like. */
    openSettings(key?: string): void;
     /** A Markdown rendering pipeline addition (permission ui:markdown). */
    registerMarkdownRenderer(def: {
      key?: string;
      remarkPlugins?: unknown[];
      rehypePlugins?: unknown[];
      components?: Record<string, unknown>;
    }): Disposer;
     /** An overlay page, routed at `#/p/<id>` (permission ui:page). */
    registerPage(def: {
      key?: string;
      title: () => string;
      component: ComponentLike;
    }): Disposer;
     /** A custom timeline row kind renderer (permission ui:timeline-row). */
    registerTimelineRowRenderer(def: {
      kind: string;
      key?: string;
      component: ComponentLike<{ row: { kind: string } }>;
    }): Disposer;
     /** A sidebar workspace row context-menu entry (permission ui:workspace-menu). */
    registerWorkspaceMenuItem(def: {
      key?: string;
      label: (ctx: { workspaceId: string; archived: boolean }) => WorkspaceMenuLabelValue;
      icon?: ComponentLike<{ className?: string }>;
      visible?: (ctx: { workspaceId: string; archived: boolean }) => boolean;
      onSelect: (ctx: { workspaceId: string; archived: boolean }) => void;
      order?: number;
    }): Disposer;
     /** A home sidebar nav entry, placed under the builtin Mission Workbench (permission
      *  ui:sidebar-entry, since 0.3.12). onOpen usually opens this plugin's center tab via
      *  openCenterTab. */
    registerSidebarNav(def: {
      key?: string;
      label: () => string;
      icon?: ComponentLike<{ className?: string }>;
      order?: number;
      onOpen: () => void;
    }): Disposer;
     /** A center tab definition (permission ui:center-tab, since 0.3.12): shares the
      *  middle tab bar with the session/file/browser tabs; opened via openCenterTab. */
    registerCenterTab(def: {
      key?: string;
      title: () => string;
      icon?: ComponentLike<{ className?: string }>;
      component: ComponentLike;
      order?: number;
    }): Disposer;
     /** Open (or focus) a center tab this plugin has registered (permission ui:center-tab,
      *  since 0.3.12); throws when the tab is not registered — a failed open must be
      *  visible. */
    openCenterTab(key?: string): void;
  };
  theme: {
     /** Inject a stylesheet (permission theme); @import and remote urls are rejected. */
    injectCss(css: string): Disposer;
     /** A shortcut for overriding BoardUI tokens; keys must be --* custom properties. */
    setTokens(tokens: { light?: Record<string, string>; dark?: Record<string, string> }): Disposer;
    /**
     *  The public contract of host tokens plugins may consume is @ccgui/plugin-ui's
     *  PLUGIN_UI_TOKEN_CONTRACT (packages/plugin-ui/src/tokens.ts): the listed
     *  --color-…, --gradient-… and similar variables are promised by the host never to
     *  be renamed or removed, so plugin styles can safely var() reference them (a
     *  fallback is recommended). To build a UI, prefer the @ccgui/plugin-ui component
     *  package over hand-rolling styles or guessing variable names.
     */
  };
  i18n: {
     /** Register a language pack (permission i18n). */
    addBundle(lang: string, ns: string, resources: Record<string, unknown>): Disposer;
  };
  storage: {
     /** Per-plugin KV (permission storage). */
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  events: {
   /** The event bus (permission events). Host topics: `usage://updated` (engine usage
     *  events passed through, the payload being the full EngineEventPayload
     *  `{ runId, sessionId, engine, seq, kind, data, ts?, genMs? }` where data is the
     *  engine's raw usage JSON); `usage://done` (since 0.3.8, engine done events passed
     *  through, data.usage carrying that turn's final usage — this is how engines that
     *  only report usage via Done, such as claude/grok, become visible to plugins);
     *  `session://activated` (since 0.3.8, active session switched, payload
     *  `{ engine, sessionId }`, where a pending tab has a null sessionId and with no
     *  active tab both are null); `composer://draft` (payload { text }, emitted on draft
     *  change, clear, and session switch).
     *  `genMs` (since 0.3.15, carried only by `usage`/`done`): the host-measured
     *  generation window in milliseconds for that report — from the response stream
     *  opening to closing, excluding tool execution, user wait, and inter-turn gaps.
     *  Dividing output tokens by genMs gives the generation speed without tool-wait
     *  time; when the field is missing (older hosts / untimed reports), fall back to the
     *  neighbouring reports' `ts` interval. */
    on(topic: string, cb: (data: unknown) => void): Disposer;
    emit(topic: string, data: unknown): void;
  };
  /** Composer draft write (permission composer:draft, since 0.3.2).
    *  Writing replaces the draft of the currently active session; it never sends —
    *  sending is always a user action. */
  composer: {
    setDraft(text: string): void;
  };
   /** Workspace registration (permission host:workspace, since 0.3.3). Register an
    *  arbitrary path as a sidebar workspace — the directory need not exist locally
    *  (e.g. a path inside an ssh-managed remote machine or WSL distribution). meta
    *  passes through onto the host workspace row (e.g. { wsl: { hostId, distro } }),
    *  consumed as needed by host capabilities like sessions and files; its shape is
    *  agreed between writer and consumer.
    *
    *  list returns the sidebar's current workspace rows (including worktree child rows,
    *  distinguished by kind) as a read-only snapshot: no meta, no group definitions. Call
    *  it again to follow changes; the host broadcasts no workspace change events to
    *  plugins.
    *
    *  A meta carrying a `wsl` key (a remote workspace, where the host engine tunnels
    *  session traffic over ssh to the host and distribution named by meta.wsl) needs the
    *  extra permission `host:workspace:remote` (since 0.3.4) — that is effectively
    *  network egress plus remote execution, far beyond registering one sidebar row.
    *  Trust tradeoff: the remote channel's first connection uses
    *  StrictHostKeyChecking=accept-new (the host key is recorded on first connect and
    *  only later changes are rejected), so plugin authors should know this is TOFU
    *  rather than strict pinning. */
  workspaces: {
    add(path: string, meta?: Record<string, unknown>): Promise<void>;
     /** A sidebar workspace snapshot (read-only; permission host:workspace, since 0.3.16).
      *  Worktree child rows additionally carry a read-only
      *  worktree: { branch, prNumber? } projection (since 0.3.17), which binds a PR to a
      *  local worktree; meta itself is still not returned. */
    list(): Promise<PluginWorkspaceRow[]>;
  };
   /** Worktree creation (permission host:worktree, since 0.3.17): created through
    *  the host's "New Worktree" pipeline (validate → fetch → add → register), with the
    *  same progress row and cancel/retry semantics in the host sidebar; on success the
    *  worktree is registered in the sidebar with kind="worktree" (its parent row is the
    *  workspace named by parentWorkspaceId), and resolves with the registered path.
    *
    *  When prNumber is present it fetches pull/<n>/head before checking out;
    *  existingBranch means branch is an existing local branch (check out, not create).
    *  The default path is the host's default layout
    *  <sibling of repo>/<repo name>-worktrees/<branch>.
    *
    *  Failure/cancel rejects with an Error whose message is "<errorKind>: <detail>"
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
       /** Create from a PR: fetch pull/<n>/head into branch. */
      prNumber?: number | null;
      prTitle?: string | null;
      prUrl?: string | null;
       /** true = branch is an existing local branch (check out, not create). */
      existingBranch?: boolean;
    }): Promise<{ worktreePath: string }>;
     /** Remove a local worktree (permission host:worktree, since 0.3.19): goes
      *  through the host sidebar's delete flow — git worktree remove (optionally
      *  deleting the branch) plus deregistering the sidebar/terminal entries. A rejection
      *  message looks like "<errorKind>: <detail>" (errorKind uses the same
      *  classification as creation, plus not_found / remove_failed). It resolves with
      *  non-fatal tails: orphanDirectory (the directory could not be removed) and
      *  branchKeptReason ("checked_out_elsewhere" | "unknown"; null = the branch was
      *  deleted or deletion was not requested). */
    remove(def: {
      repoPath: string;
      worktreePath: string;
      branch?: string | null;
      deleteBranch?: boolean;
    }): Promise<{ orphanDirectory: boolean; branchKeptReason: string | null }>;
  };
   /** Session opening + external session sources (permission host:session; selectSession
    *  since 0.3.3, registerSource since 0.3.4). registerSource registers an async
    *  session source; the host calls list() on every session directory refresh
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
      *  host:session): the session appears in the sidebar immediately (with running
      *  state, no manual sync needed) and opens onto a live stream; it can be stopped
      *  from the chat or via interruptRun. The session hangs under the workspacePath
      *  workspace, and the model/effort/channel override applies to this turn only,
      *  leaving the user's global defaults untouched.
      *
      *  How it differs from ctx.agent.start: that one is the plugin's own background
      *  turn (events go only to the plugin, never into chat); this one is "as if the
      *  user sent a message". Use this method for turns the user should see and can
      *  take over or stop at any time.
      *
      *  After a successful spawn it resolves with { runId, sessionId } (sessionId is
      *  null when the engine announces it later); termination is reported back over
      *  the plugin-run://<pluginId> event channel:
      *  { runId, sessionId, engine, workspacePath, kind: "done" | "error", error }.
      *  Turns interrupted by the user or the plugin still finish with done. */
    startRun(def: {
      engine: string;
      prompt: string;
       /** The workspace path the session belongs to (e.g. a worktree). */
      workspacePath: string;
       /** The model id for this turn (a models[].id from ctx.agent.catalog). */
      model?: string | null;
       /** The reasoning effort for this turn (one level from the catalog's efforts). */
      effort?: string | null;
       /** The channel id for this turn (a providers[].id from the catalog). */
      providerId?: string | null;
    }): Promise<{ runId: string; sessionId: string | null }>;
     /** Stop a turn started by startRun (equivalent to the chat's stop button). Only
      *  turns this plugin started via startRun and that are still running may be
      *  stopped: with no matching running turn it rejects, so it never stops a user's or
      *  another plugin's session; `sessionId: null` matches any running turn of this
      *  plugin on that engine + workspace (the native id may only be announced after
      *  startRun returns). */
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
   /** Main window access (permission host:window, SDK 0.3.19; host >= 1.0.10). Physical
    *  pixel coordinates; setting bounds only allows a normal-state window and requires it
    *  to stay within a connected screen. WeChat sampling is detected on Windows by the
    *  process name Weixin.exe/WeChat.exe; other platforms return Unsupported. */
  window: {
    getState(): Promise<PluginWindowSnapshot>;
    setNormalBounds(bounds: PluginWindowBounds): Promise<PluginWindowSnapshot>;
    sampleWechat(): Promise<PluginWechatWindow>;
  };
   /** The authoritative host model catalog (permission host:models, SDK 0.3.19; host >= 1.0.10).
    *  Returns the public fields of engine/model plus the authoritative/remote flags; no
    *  keys, tokens, or full provider config. */
  models: {
    listEngines(): Promise<PluginEngineInfo[]>;
    listEngineModels(engine: string, workspace?: string): Promise<PluginEngineCatalog>;
     /** Only reaches the network when refreshProviders=true; the caller must bind it to an explicit user action. */
    catalog(options?: {
      workspace?: string;
      refreshProviders?: boolean;
    }): Promise<PluginModelCatalogResult>;
  };
   /** Agent turns (permission `agent`, since 0.3.13): starts an agent process through
   *  the host engine pipeline — structurally the same as channel injection, process
   *  registration, and a chat send. Events are pushed over the `agent://<pluginId>`
   *  bus topic (subscribe via ctx.events.on). Desktop only. */
  agent: {
    catalog(workspacePath: string): Promise<PluginAgentCatalogEntry[]>;
    start(def: {
      engine: string;
      prompt: string;
      workspacePath: string;
      model?: string;
      providerId?: string;
      sessionId?: string;
      readOnly?: boolean;
      requestId?: string;
    }): Promise<{ runId: string; sessionId: string | null }>;
    interrupt(runId: string): Promise<boolean>;
  };
  bridge: {
     /** The general capability outlet (since 0.3.0; the old per-command `cmd:<command>`
      *  authorization mechanism was removed). Only four commands are available, and
      *  `pluginId` is injected by the host (the plugin neither needs to nor may pass it):
      *
      *  - `plugin_http_request` `{ method, url, headers?, body? }` →
      *    `{ status, body }`: the url is restricted to http/https, and the host (plus port)
      *    must match the manifest's
      *    `network:<host>` / `network:<host>:<port>` / `network:<host>:<a>-<b>` grant
      *    (shapes and allow rules are governed by spec/permissions.json).
      *  - `plugin_exec_run` `{ bin, args, env?, timeoutMs? }` →
      *    `{ code, stdout, stderr }`: bin must match an `exec:<bin>` grant (bare name, no
      *    path).
      *  - `plugin_exec_spawn` `{ bin, args, env?, lifecycle? }` → void:
      *    the same grant requirement; resolves to void on success (Rust returns ()), rejects
      *    on failure. lifecycle defaults to "detached" (a user-level service that outlives
      *    the plugin); "plugin" = a child process the host tracks and kills automatically
      *    when the plugin is disabled or uninstalled.
      *  - `plugin_exec_kill` `{}` → `{ killed: number }`: kills every lifecycle="plugin"
      *    child of this plugin (a config change renames it to re-enable; any exec: grant
      *    required).
      *
      *  A call whose grant does not match is rejected on the JS side (no IPC round trip);
      *  Rust separately enforces grants and plugin enabled-state (defense in depth). */
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  host: {
    appVersion: string;
     /** The SDK version the host implements (= @ccgui/plugin-sdk version). */
    sdkVersion: string;
    locale: string;
     /** True in the web client; the desktop-only bridge commands above are unavailable there. */
    isWeb: boolean;
  };
}
