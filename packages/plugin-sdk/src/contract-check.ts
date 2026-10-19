import type * as Pub from "../plugin";
import type {
  AfterTurnEvent,
  AssetDirectoryGrant,
  AssistantCompletedEvent,
  BeforeTurnEvent,
  BeforeTurnResult,
  ComposerSlotId,
  CommandFinishedEvent,
  CommandStartedEvent,
  Disposer,
  DocumentReadResult,
  DocumentStorage,
  DocumentStorageLocationKind,
  DocumentWriteResult,
  ExternalSessionRow,
  FileChangedEvent,
  InternalMessageCapture,
  InternalMessageEvent,
  isValidPluginId,
  JsonSchemaObject,
  JsonSchemaProperty,
  NormalizedRuntimeEvent,
  PermissionRequestedEvent,
  PluginAssets,
  PluginContext,
  PluginConversationProps,
  PluginAgentCatalogEntry,
  PluginEngineCatalog,
  PluginEngineInfo,
  PluginEngineModel,
  PluginModelCatalogEngine,
  PluginModelCatalogError,
  PluginModelCatalogResult,
  PluginModelSource,
  PluginWindowBounds,
  PluginWindowSnapshot,
  PluginWechatWindow,
  PluginWorkspaceRow,
  PluginManifest,
  PluginTier,
  PromptContribution,
  ResolvedDocumentStorageLocation,
  RuntimeExitedEvent,
  RuntimeSwitchEvent,
  RuntimeSwitchHooks,
  SessionClosedEvent,
  SessionCreatedEvent,
  SessionHooks,
  SessionMenuTarget,
  SessionRestoredEvent,
  ToolFinishedEvent,
  TurnCancelledEvent,
  TurnFailedEvent,
  TurnHooks,
  WorkspaceMenuLabel,
  WorkspaceMenuLabelValue,
  WorkspaceMenuStatusTone,
  WorkspaceMetadata,
} from "./index";

/**
 * The contract drift guard (pure types, no runtime code; participates in typecheck
 * via the tsconfig include, deliberately not exported from the barrel).
 *
 * The package root plugin.d.ts is the mirror of the public API plugin authors
 * see (same pattern as VS Code's vscode.d.ts) and must stay in sync with the
 * host-side definitions in src/*: any add, remove, or reshape on either side is a
 * compile error here.
 *
 * Two assertion dimensions:
 * - Mutual: bidirectionally assignable (structurally equivalent), for pure data
 *   types with no component fields.
 * - KeyParity: identical key sets (adding or removing a method fails), for the
 *   PluginContext capability groups. The ui group contains component types —
 *   plugin.d.ts uses its own ComponentLike while the host side uses React
 *   ComponentType (a deliberate divergence, since the blob bundle cannot share
 *   React type identity) — so groups containing components check keys only.
 */

/** T must be true to instantiate; false falls outside the extends constraint and is a
 *  compile error. */
type Assert<T extends true> = T;

/** A and B are bidirectionally assignable. Tuple wrapping avoids union-type
 *  distributive-law interference. */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** A and B have exactly the same key set (bidirectional subset). */
type KeyParity<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false;

// --- Pure data types: bidirectional assignability ---------------------------

export type _PluginManifest = Assert<Mutual<PluginManifest, Pub.PluginManifest>>;
export type _JsonSchemaObject = Assert<Mutual<JsonSchemaObject, Pub.JsonSchemaObject>>;
export type _JsonSchemaProperty = Assert<Mutual<JsonSchemaProperty, Pub.JsonSchemaProperty>>;
export type _ComposerSlotId = Assert<Mutual<ComposerSlotId, Pub.ComposerSlotId>>;
export type _SessionMenuTarget = Assert<Mutual<SessionMenuTarget, Pub.SessionMenuTarget>>;
export type _PluginTier = Assert<Mutual<PluginTier, Pub.PluginTier>>;
export type _Disposer = Assert<Mutual<Disposer, Pub.Disposer>>;
export type _PluginIdValidator = Assert<Mutual<typeof isValidPluginId, typeof Pub.isValidPluginId>>;
export type _WorkspaceMetadata = Assert<Mutual<WorkspaceMetadata, Pub.WorkspaceMetadata>>;
export type _PluginWorkspaceRow = Assert<Mutual<PluginWorkspaceRow, Pub.PluginWorkspaceRow>>;
export type _ExternalSessionRow = Assert<Mutual<ExternalSessionRow, Pub.ExternalSessionRow>>;
export type _WorkspaceMenuStatusTone = Assert<Mutual<WorkspaceMenuStatusTone, Pub.WorkspaceMenuStatusTone>>;
export type _WorkspaceMenuLabel = Assert<Mutual<WorkspaceMenuLabel, Pub.WorkspaceMenuLabel>>;
export type _WorkspaceMenuLabelValue = Assert<Mutual<WorkspaceMenuLabelValue, Pub.WorkspaceMenuLabelValue>>;
export type _WindowBounds = Assert<Mutual<PluginWindowBounds, Pub.PluginWindowBounds>>;
export type _WindowSnapshot = Assert<Mutual<PluginWindowSnapshot, Pub.PluginWindowSnapshot>>;
export type _WechatWindow = Assert<Mutual<PluginWechatWindow, Pub.PluginWechatWindow>>;
export type _EngineInfo = Assert<Mutual<PluginEngineInfo, Pub.PluginEngineInfo>>;
export type _EngineModel = Assert<Mutual<PluginEngineModel, Pub.PluginEngineModel>>;
export type _EngineCatalog = Assert<Mutual<PluginEngineCatalog, Pub.PluginEngineCatalog>>;
export type _ModelCatalogEngine = Assert<Mutual<PluginModelCatalogEngine, Pub.PluginModelCatalogEngine>>;
export type _ModelSource = Assert<Mutual<PluginModelSource, Pub.PluginModelSource>>;
export type _ModelCatalogError = Assert<Mutual<PluginModelCatalogError, Pub.PluginModelCatalogError>>;
export type _ModelCatalogResult = Assert<Mutual<PluginModelCatalogResult, Pub.PluginModelCatalogResult>>;

export type _PromptContribution = Assert<Mutual<PromptContribution, Pub.PromptContribution>>;
export type _InternalMessageCapture = Assert<Mutual<InternalMessageCapture, Pub.InternalMessageCapture>>;
export type _BeforeTurnResult = Assert<Mutual<BeforeTurnResult, Pub.BeforeTurnResult>>;
export type _SessionCreatedEvent = Assert<Mutual<SessionCreatedEvent, Pub.SessionCreatedEvent>>;
export type _SessionRestoredEvent = Assert<Mutual<SessionRestoredEvent, Pub.SessionRestoredEvent>>;
export type _SessionClosedEvent = Assert<Mutual<SessionClosedEvent, Pub.SessionClosedEvent>>;
export type _BeforeTurnEvent = Assert<Mutual<BeforeTurnEvent, Pub.BeforeTurnEvent>>;
export type _AfterTurnEvent = Assert<Mutual<AfterTurnEvent, Pub.AfterTurnEvent>>;
export type _InternalMessageEvent = Assert<Mutual<InternalMessageEvent, Pub.InternalMessageEvent>>;
export type _RuntimeSwitchEvent = Assert<Mutual<RuntimeSwitchEvent, Pub.RuntimeSwitchEvent>>;
export type _FileChangedEvent = Assert<Mutual<FileChangedEvent, Pub.FileChangedEvent>>;
export type _CommandStartedEvent = Assert<Mutual<CommandStartedEvent, Pub.CommandStartedEvent>>;
export type _CommandFinishedEvent = Assert<Mutual<CommandFinishedEvent, Pub.CommandFinishedEvent>>;
export type _ToolFinishedEvent = Assert<Mutual<ToolFinishedEvent, Pub.ToolFinishedEvent>>;
export type _PermissionRequestedEvent = Assert<Mutual<PermissionRequestedEvent, Pub.PermissionRequestedEvent>>;
export type _AssistantCompletedEvent = Assert<Mutual<AssistantCompletedEvent, Pub.AssistantCompletedEvent>>;
export type _TurnCancelledEvent = Assert<Mutual<TurnCancelledEvent, Pub.TurnCancelledEvent>>;
export type _TurnFailedEvent = Assert<Mutual<TurnFailedEvent, Pub.TurnFailedEvent>>;
export type _RuntimeExitedEvent = Assert<Mutual<RuntimeExitedEvent, Pub.RuntimeExitedEvent>>;
export type _NormalizedRuntimeEvent = Assert<Mutual<NormalizedRuntimeEvent, Pub.NormalizedRuntimeEvent>>;
export type _SessionHooks = Assert<Mutual<SessionHooks, Pub.SessionHooks>>;
export type _TurnHooks = Assert<Mutual<TurnHooks, Pub.TurnHooks>>;
export type _RuntimeSwitchHooks = Assert<Mutual<RuntimeSwitchHooks, Pub.RuntimeSwitchHooks>>;
export type _DocumentStorageLocationKind = Assert<
  Mutual<DocumentStorageLocationKind, Pub.DocumentStorageLocationKind>
>;
export type _ResolvedDocumentStorageLocation = Assert<
  Mutual<ResolvedDocumentStorageLocation, Pub.ResolvedDocumentStorageLocation>
>;
export type _DocumentReadResult = Assert<Mutual<DocumentReadResult, Pub.DocumentReadResult>>;
export type _DocumentWriteResult = Assert<Mutual<DocumentWriteResult, Pub.DocumentWriteResult>>;
export type _DocumentStorage = Assert<Mutual<DocumentStorage, Pub.DocumentStorage>>;
export type _AssetDirectoryGrant = Assert<Mutual<AssetDirectoryGrant, Pub.AssetDirectoryGrant>>;
export type _PluginAssets = Assert<Mutual<PluginAssets, Pub.PluginAssets>>;

// --- Optional-member drift ---------------------------------------------------
// Mutual's bidirectional assignability is blind to "one side gains an **optional**
// field / optional parameter" (optional properties and trailing optional params are
// ignored in structural assignment). So the optional members added in this change
// get their own assertions: a struct with optional fields checks its key set, a
// method with optional params checks its parameter tuple.

/** A single method's parameter tuple — catches optional-parameter differences,
 *  which Mutual is blind to. */
type Params<F> = F extends (...args: infer P) => unknown ? P : never;

export type _BeforeTurnResultKeys = Assert<KeyParity<BeforeTurnResult, Pub.BeforeTurnResult>>;
export type _TurnHooksKeys = Assert<KeyParity<TurnHooks, Pub.TurnHooks>>;
export type _InternalMessageCaptureKeys = Assert<
  KeyParity<InternalMessageCapture, Pub.InternalMessageCapture>
>;
export type _DocumentStorageRemoveParams = Assert<
  Mutual<Params<DocumentStorage["remove"]>, Params<Pub.DocumentStorage["remove"]>>
>;
export type _ConversationProps = Assert<Mutual<PluginConversationProps, Pub.PluginConversationProps>>;
export type _AgentCatalogEntry = Assert<Mutual<PluginAgentCatalogEntry, Pub.PluginAgentCatalogEntry>>;
export type _AgentShape = Assert<Mutual<PluginContext["agent"], Pub.PluginContext["agent"]>>;

// --- PluginContext: the top level and every capability group align on keys ------

export type _ContextKeys = Assert<KeyParity<PluginContext, Pub.PluginContext>>;
export type _UiKeys = Assert<KeyParity<PluginContext["ui"], Pub.PluginContext["ui"]>>;
export type _ThemeKeys = Assert<KeyParity<PluginContext["theme"], Pub.PluginContext["theme"]>>;
export type _I18nKeys = Assert<KeyParity<PluginContext["i18n"], Pub.PluginContext["i18n"]>>;
export type _StorageKeys = Assert<KeyParity<PluginContext["storage"], Pub.PluginContext["storage"]>>;
export type _EventsKeys = Assert<KeyParity<PluginContext["events"], Pub.PluginContext["events"]>>;
export type _ComposerKeys = Assert<KeyParity<PluginContext["composer"], Pub.PluginContext["composer"]>>;
export type _WorkspacesKeys = Assert<KeyParity<PluginContext["workspaces"], Pub.PluginContext["workspaces"]>>;
export type _WorktreesKeys = Assert<KeyParity<PluginContext["worktrees"], Pub.PluginContext["worktrees"]>>;
export type _SessionsKeys = Assert<KeyParity<PluginContext["sessions"], Pub.PluginContext["sessions"]>>;
export type _WindowKeys = Assert<KeyParity<PluginContext["window"], Pub.PluginContext["window"]>>;
export type _ModelsKeys = Assert<KeyParity<PluginContext["models"], Pub.PluginContext["models"]>>;
export type _BridgeKeys = Assert<KeyParity<PluginContext["bridge"], Pub.PluginContext["bridge"]>>;
export type _HostKeys = Assert<KeyParity<PluginContext["host"], Pub.PluginContext["host"]>>;
export type _HooksKeys = Assert<KeyParity<PluginContext["hooks"], Pub.PluginContext["hooks"]>>;
export type _WorkspaceKeys = Assert<KeyParity<PluginContext["workspace"], Pub.PluginContext["workspace"]>>;
export type _AssetsKeys = Assert<KeyParity<PluginContext["assets"], Pub.PluginContext["assets"]>>;
export type _ShellKeys = Assert<KeyParity<PluginContext["shell"], Pub.PluginContext["shell"]>>;
export type _AgentKeys = Assert<KeyParity<PluginContext["agent"], Pub.PluginContext["agent"]>>;
export type _DocumentStorageKeys = Assert<
  KeyParity<PluginContext["documentStorage"], Pub.PluginContext["documentStorage"]>
>;

// --- Capability groups without component fields: also require mutual assignability --

export type _ThemeShape = Assert<Mutual<PluginContext["theme"], Pub.PluginContext["theme"]>>;
export type _I18nShape = Assert<Mutual<PluginContext["i18n"], Pub.PluginContext["i18n"]>>;
export type _StorageShape = Assert<Mutual<PluginContext["storage"], Pub.PluginContext["storage"]>>;
export type _EventsShape = Assert<Mutual<PluginContext["events"], Pub.PluginContext["events"]>>;
export type _ComposerShape = Assert<Mutual<PluginContext["composer"], Pub.PluginContext["composer"]>>;
export type _WorkspacesShape = Assert<Mutual<PluginContext["workspaces"], Pub.PluginContext["workspaces"]>>;
export type _WorktreesShape = Assert<Mutual<PluginContext["worktrees"], Pub.PluginContext["worktrees"]>>;
export type _SessionsShape = Assert<Mutual<PluginContext["sessions"], Pub.PluginContext["sessions"]>>;
export type _WindowShape = Assert<Mutual<PluginContext["window"], Pub.PluginContext["window"]>>;
export type _ModelsShape = Assert<Mutual<PluginContext["models"], Pub.PluginContext["models"]>>;
export type _BridgeShape = Assert<Mutual<PluginContext["bridge"], Pub.PluginContext["bridge"]>>;
export type _HostShape = Assert<Mutual<PluginContext["host"], Pub.PluginContext["host"]>>;
export type _HooksShape = Assert<Mutual<PluginContext["hooks"], Pub.PluginContext["hooks"]>>;
export type _WorkspaceShape = Assert<Mutual<PluginContext["workspace"], Pub.PluginContext["workspace"]>>;
export type _AssetsShape = Assert<Mutual<PluginContext["assets"], Pub.PluginContext["assets"]>>;
export type _ShellShape = Assert<Mutual<PluginContext["shell"], Pub.PluginContext["shell"]>>;
export type _DocumentStorageShape = Assert<
  Mutual<PluginContext["documentStorage"], Pub.PluginContext["documentStorage"]>
>;
