import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * 内置插件开发 skill 的文档生成器（scripts/build-plugin-skill-docs.ts +
 * creator-skill-docs.test.ts 消费；应用代码不 import 本模块）。
 *
 * 动机：skill 是插件作者（含 AI）看到的 SDK 说明书，而 SDK 会持续迭代。
 * 与其靠人记得同步，不如让 SDK/宿主源码成为唯一事实源——本模块用 TS AST
 * 从以下文件派生 skill 内的 `references/sdk-api.md`：
 *
 * - packages/plugin-sdk/src/version.ts          SDK_VERSION
 * - packages/plugin-sdk/src/manifest.ts         manifest 字段 + activate 契约
 * - packages/plugin-sdk/src/context.ts          PluginContext 各能力组与签名
 * - packages/plugin-sdk/spec/permissions.json   权限全集（安全边界）
 * - src/features/plugins/runtime/context.ts     扩展点 → 权限门禁（requirePermission）
 *
 * `SKILL.md`（工作流与硬性约束）手写，references/ 下的 SDK 参考全部由本模块生成；
 * 测试断言磁盘内容 == 生成内容：SDK 改了没重新生成就红。
 *
 * 刻意不复制 docs/plugin-development-guide.zh-CN.md：那份规范面向市场提交，
 * 且当前已与 SDK 漂移（如已不存在的 repo/license 字段、events:usage 权限）；
 * 复制一份过期快照进 skill 比没有更糟。
 */

/** skill 在仓库内的源目录（同时是 Tauri 资源目录，见 tauri.conf.json）。 */
export const CREATOR_SKILL_DIR = "src-tauri/resources/skills/zaino-plugin-creator";

/** 生成物相对 skill 根的文件名。 */
export const GENERATED_SDK_DOC = "references/sdk-api.md";

/** 仓库根：本文件位于 <root>/src/features/plugins/skill/。 */
export function repoRootFromHere(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export interface SkillDocFile {
  /** 相对 skill 根的路径（POSIX 分隔符）。 */
  path: string;
  content: string;
}

// ── AST 工具 ────────────────────────────────────────────────────────────────

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
}

/** JSDoc 全文压成一行（表格里要单行；多行说明全部保留，不截断）。 */
function jsDocLine(node: ts.Node): string {
  const docs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
  const comment = docs.length ? (docs[docs.length - 1] as ts.JSDoc).comment : undefined;
  if (comment === undefined) return "";
  const text = typeof comment === "string" ? comment : comment.map((c) => c.text).join("");
  return text
    .replace(/^\s*\*?\s?/gm, " ")
    .replace(/\s+/g, " ")
    .replace(/"$/g, "")
    .trim();
}

/** 表格单元格：不能有换行，`|` 需转义。 */
function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function literalName(node: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return null;
}

// ── 紧凑类型渲染（生成的签名要一行一条，人能读、模型能抄） ──────────────────

function compactParams(params: readonly ts.ParameterDeclaration[]): string {
  return params
    .map((p) => {
      const name = typeof p.name.getText === "function" ? p.name.getText() : "";
      const rest = p.dotDotDotToken ? "..." : "";
      const optional = p.questionToken ? "?" : "";
      return `${rest}${name}${optional}: ${compactType(p.type)}`;
    })
    .join(", ");
}

/** 方法签名的类型参数（如 `get<T>`）：丢掉会让引用它的插件写出错误代码。 */
function compactTypeParams(params: readonly ts.TypeParameterDeclaration[] | undefined): string {
  if (!params || params.length === 0) return "";
  return `<${params
    .map((p) =>
      p.constraint
        ? `${p.name.getText()} extends ${compactType(p.constraint)}`
        : p.name.getText(),
    )
    .join(", ")}>`;
}

function compactMember(member: ts.TypeElement): string {
  if (ts.isPropertySignature(member)) {
    const name = literalName(member.name) ?? member.name.getText();
    const optional = member.questionToken ? "?" : "";
    const type = member.type;
    if (type && ts.isFunctionTypeNode(type)) {
      return `${name}${optional}${compactTypeParams(type.typeParameters)}(${compactParams(type.parameters)}): ${compactType(type.type)}`;
    }
    return `${name}${optional}: ${compactType(type)}`;
  }
  if (ts.isMethodSignature(member)) {
    const name = literalName(member.name) ?? member.name.getText();
    const optional = member.questionToken ? "?" : "";
    return `${name}${optional}${compactTypeParams(member.typeParameters)}(${compactParams(member.parameters)}): ${compactType(member.type)}`;
  }
  return "";
}

/** 递归渲染类型源码文本：类型字面量收成一行，避免 printer 把 `{ className?: string }` 折成四行。 */
function compactType(node: ts.TypeNode | undefined): string {
  if (!node) return "";
  switch (node.kind) {
    case ts.SyntaxKind.TypeLiteral: {
      const members = (node as ts.TypeLiteralNode).members.map(compactMember).filter(Boolean);
      return members.length ? `{ ${members.join("; ")} }` : "{}";
    }
    case ts.SyntaxKind.FunctionType: {
      const fn = node as ts.FunctionTypeNode;
      return `(${compactParams(fn.parameters)}) => ${compactType(fn.type)}`;
    }
    case ts.SyntaxKind.UnionType:
      return (node as ts.UnionTypeNode).types.map((t) => compactType(t)).join(" | ");
    case ts.SyntaxKind.IntersectionType:
      return (node as ts.IntersectionTypeNode).types.map((t) => compactType(t)).join(" & ");
    case ts.SyntaxKind.ArrayType:
      return `${compactType((node as ts.ArrayTypeNode).elementType)}[]`;
    case ts.SyntaxKind.ParenthesizedType:
      return `(${compactType((node as ts.ParenthesizedTypeNode).type)})`;
    case ts.SyntaxKind.TypeReference: {
      const ref = node as ts.TypeReferenceNode;
      const base = ref.typeName.getText();
      const args = ref.typeArguments;
      return args && args.length > 0 ? `${base}<${args.map((t) => compactType(t)).join(", ")}>` : base;
    }
    default:
      return node.getText().replace(/\s+/g, " ").trim();
  }
}

// ── 源码提取 ────────────────────────────────────────────────────────────────

interface ManifestField {
  name: string;
  type: string;
  optional: boolean;
  doc: string;
}

interface ContextMember {
  name: string;
  /** 成员签名，一行（`name(args): T`）或属性（`name: T`）。 */
  signature: string;
  doc: string;
}

interface ContextGroup {
  name: string;
  doc: string;
  members: ContextMember[];
}

function extractManifest(source: ts.SourceFile): ManifestField[] {
  const fields: ManifestField[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "PluginManifest") {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member)) continue;
        const name = literalName(member.name);
        if (!name) continue;
        fields.push({
          name,
          type: compactType(member.type),
          optional: Boolean(member.questionToken),
          doc: jsDocLine(member),
        });
      }
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (fields.length === 0) throw new Error("[plugin-skill] PluginManifest not found in manifest.ts");
  return fields;
}

/** activate 的返回值类型（清理函数），不是整个函数类型。 */
function extractActivateReturn(source: ts.SourceFile): string {
  let code = "";
  const walk = (node: ts.Node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === "PluginActivate") {
      const type = node.type;
      if (ts.isFunctionTypeNode(type)) code = compactType(type.type);
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (!code) throw new Error("[plugin-skill] PluginActivate not found in manifest.ts");
  return code;
}

/** PluginContext：类型字面量成员是能力组，其余（pluginId/react/host…）是标量属性。 */
function extractContextGroups(source: ts.SourceFile): { groups: ContextGroup[]; scalars: ContextMember[] } {
  const groups: ContextGroup[] = [];
  const scalars: ContextMember[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "PluginContext") {
      for (const member of node.members) {
        const name = literalName(member.name);
        if (!name || !ts.isPropertySignature(member)) continue;
        const type = member.type;
        if (type && ts.isTypeLiteralNode(type)) {
          const members: ContextMember[] = [];
          for (const inner of type.members) {
            const signature = compactMember(inner);
            if (!signature) continue;
            members.push({ name: signature.split(/[(?:]/)[0]!, signature, doc: jsDocLine(inner) });
          }
          groups.push({ name, doc: jsDocLine(member), members });
          continue;
        }
        scalars.push({ name, signature: `${name}${member.questionToken ? "?" : ""}: ${compactType(type)}`, doc: jsDocLine(member) });
      }
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (groups.length === 0) throw new Error("[plugin-skill] PluginContext not found in context.ts");
  return { groups, scalars };
}

/**
 * 扩展点 → 权限：宿主运行时每个受门禁的方法首句是
 * `requirePermission("<权限>")`；嵌套在条件里的额外门禁（如
 * host:workspace:remote）按出现顺序排在后面，渲染时标为「按需」。
 *
 * 直接调用不够：`ctx.theme.setTokens` 自己不写 requirePermission，而是转发给
 * `ctx.theme.injectCss`。因此还要收集方法体内对同包其他方法的调用，做传递闭包。
 */
function extractPermissionGates(source: ts.SourceFile): Map<string, string[]> {
  interface Raw {
    direct: string[];
    calls: string[];
  }
  const raw = new Map<string, Raw>();
  const collectCalls = (node: ts.Node, gates: string[], calls: string[]) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "requirePermission"
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) gates.push(arg.text);
    }
    // ctx.<group>.<method>(…) 转发调用（只认 ctx 开头，避免误抓同名局部函数）
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const owner = node.expression.expression;
      if (
        ts.isPropertyAccessExpression(owner) &&
        owner.expression.getText(source) === "ctx"
      ) {
        calls.push(`${owner.name.text}.${method}`);
      }
    }
    ts.forEachChild(node, (child) => collectCalls(child, gates, calls));
  };
  const walkObject = (obj: ts.ObjectLiteralExpression, prefix: string[]) => {
    for (const prop of obj.properties) {
      const name = literalName(prop.name);
      if (!name) continue;
      const pathParts = [...prefix, name];
      const body = ts.isPropertyAssignment(prop)
        ? prop.initializer
        : ts.isMethodDeclaration(prop)
          ? prop
          : undefined;
      if (!body) continue;
      if (ts.isObjectLiteralExpression(body)) {
        walkObject(body, pathParts);
        continue;
      }
      const gates: string[] = [];
      const calls: string[] = [];
      collectCalls(body, gates, calls);
      if (gates.length > 0 || calls.length > 0) {
        raw.set(pathParts.join("."), { direct: gates, calls });
      }
    }
  };
  const walk = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      literalName(node.name) === "ctx" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      walkObject(node.initializer, []);
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(source);

  // 传递闭包：转发到受门禁方法的，继承其权限（固定点，链式转发也能收敛）。
  const resolve = (path: string, seen: Set<string>): string[] => {
    const entry = raw.get(path);
    if (!entry || seen.has(path)) return [];
    if (entry.direct.length > 0) return entry.direct;
    seen.add(path);
    for (const called of entry.calls) {
      const inherited = resolve(called, seen);
      if (inherited.length > 0) return inherited;
    }
    return [];
  };
  const gates = new Map<string, string[]>();
  for (const path of raw.keys()) {
    const resolved = resolve(path, new Set());
    if (resolved.length > 0) gates.set(path, resolved);
  }
  if (gates.size === 0) {
    throw new Error("[plugin-skill] no requirePermission gates found in host context.ts");
  }
  return gates;
}

interface BridgeCommand {
  commands: string[];
  /** 该分支要求的授权（裸字符串或 `network:`/`exec:` 形状描述）。 */
  grants: string[];
}

/**
 * `ctx.bridge.invoke` 的命令表：宿主用 `if (command === "x")` 链逐命令预检授权，
 * 每个分支里的授权检查就是该命令需要的声明。硬写进文档会随实现漂移，所以从
 * if/else 链提取（命令集与授权一起）。
 */
function extractBridgeCommands(source: ts.SourceFile): BridgeCommand[] {
  const out: BridgeCommand[] = [];
  const commandEquals = (cond: ts.Node, acc: string[]) => {
    if (
      ts.isBinaryExpression(cond) &&
      cond.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isIdentifier(cond.left) &&
      cond.left.text === "command" &&
      ts.isStringLiteral(cond.right)
    ) {
      acc.push(cond.right.text);
    }
    ts.forEachChild(cond, (child) => commandEquals(child, acc));
  };
  const grantsIn = (node: ts.Node, acc: string[]) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        if (callee.text === "networkGrantAllows") acc.push("`network:<host>` grant");
        if (callee.text === "execGrantAllows") acc.push("`exec:<bin>` grant");
      }
      if (ts.isPropertyAccessExpression(callee)) {
        const arg = node.arguments[0];
        const literal = arg && ts.isStringLiteral(arg) ? arg.text : null;
        if (callee.name.text === "includes" && literal) acc.push(`\`${literal}\``);
        if (callee.name.text === "startsWith" && literal) acc.push(`any \`${literal}\` grant`);
      }
    }
    ts.forEachChild(node, (child) => grantsIn(child, acc));
  };
  const walkIfs = (node: ts.Node) => {
    if (ts.isIfStatement(node)) {
      const commands: string[] = [];
      commandEquals(node.expression, commands);
      if (commands.length > 0) {
        const grants: string[] = [];
        grantsIn(node.thenStatement, grants);
        out.push({ commands, grants: [...new Set(grants)] });
      }
    }
    ts.forEachChild(node, walkIfs);
  };
  // 定位 bridge.invoke 之后再看它的 if 链。
  walkIfs(source);
  if (out.length === 0) throw new Error("[plugin-skill] bridge command table not found in host context.ts");
  return out;
}

interface PermissionsSpec {
  knownPermissions: string[];
  networkGrantShapes: { valid: string[]; invalid: string[] };
}

function readPermissionsSpec(file: string): PermissionsSpec {
  const spec = JSON.parse(readFileSync(file, "utf8")) as Partial<PermissionsSpec>;
  if (!Array.isArray(spec.knownPermissions) || spec.knownPermissions.length === 0) {
    throw new Error(`[plugin-skill] knownPermissions missing in ${file}`);
  }
  return {
    knownPermissions: spec.knownPermissions,
    networkGrantShapes: spec.networkGrantShapes ?? { valid: [], invalid: [] },
  };
}

function extractSdkVersion(file: string): string {
  const match = readFileSync(file, "utf8").match(/export const SDK_VERSION = "([^"]+)"/);
  if (!match) throw new Error("[plugin-skill] SDK_VERSION not found in version.ts");
  return match[1]!;
}

// ── 渲染 ────────────────────────────────────────────────────────────────────

/** 权限单元格：首个是调用前置条件，其余是特定分支的附加授权。 */
function permissionCell(perms: string[] | undefined): string {
  if (!perms || perms.length === 0) return "—";
  const [required, ...extra] = perms;
  const base = `\`${required}\``;
  return extra.length > 0 ? `${base} (+ ${extra.map((p) => `\`${p}\``).join(", ")}, as needed)` : base;
}

function renderHeader(sdkVersion: string): string {
  return [
    "<!-- Generated from source by src/features/plugins/skill/creator-skill-docs.ts. Do not edit by hand. -->",
    "<!-- Regenerate: pnpm plugin-skill:docs (creator-skill-docs.test.ts asserts this file matches the generator). -->",
    "",
    `# Zaino AI Agent Plugin SDK Reference (SDK ${sdkVersion})`,
    "",
    "This file is derived by script from `packages/plugin-sdk` (the public contract) and the host runtime (permission gates). It belongs to the `zaino-plugin-creator` skill.",
    "Fields, methods, and permissions are authoritative here: **any API not in this document does not exist** — never guess a method or permission name from memory.",
    "",
  ].join("\n");
}

function renderManifest(fields: ManifestField[], activateReturn: string): string {
  return [
    "## manifest.json fields",
    "",
    fenced(
      "ts",
      [
        "export default function activate(ctx: PluginContext): " + activateReturn + " {",
        "  …",
        "}",
      ].join("\n"),
    ),
    "",
    "The optional return value is the unload cleanup function: it runs first on unload, then every Disposer runs in reverse registration order; " +
      "the plugin never needs to (and should not) keep its own Disposer list.",
    "",
    "| Field | Type | Required | Description |",
    "|---|---|---|---|",
    ...fields.map(
      (f) =>
        `| \`${f.name}\`${f.optional ? "?" : ""} | \`${cell(f.type)}\` | ${f.optional ? "optional" : "required"} | ${cell(f.doc) || "—"} |`,
    ),
    "",
    "Field value rules (`id` naming, how `version` maps to the Release tag, `tier` values, `configSchema` rendering scope, declarative `contributes` capabilities) are in " +
      "`references/development-guide.md` §5 and §8.",
    "",
    "### Version handshake",
    "",
    "- `sdkVersion` accepts `\"*\"`, exact `\"0.3.13\"`, `\"^0.3\"`, `\"~0.3.0\"`, `\">=0.3.0\"`; anything else never satisfies (the plugin goes incompatible — the host never lets it through silently).",
    "- Runtime self-checks use `ctx.host.sdkVersion` / `ctx.host.appVersion`; the host compares `minAppVersion` before loading.",
    "",
  ].join("\n");
}

function renderExtensionTable(groups: ContextGroup[], gates: Map<string, string[]>): string {
  const rows: string[] = [];
  for (const group of groups) {
    for (const member of group.members) {
      const gate = gates.get(`${group.name}.${member.name}`);
      // 标量能力组（composer/workspaces/…）的入口也列，ui 之外没有门禁的略过。
      if (!gate && group.name !== "ui") continue;
      rows.push(`| \`ctx.${group.name}.${member.name}\` | ${permissionCell(gate)} | ${cell(member.doc) || "—"} |`);
    }
  }
  return [
    "## Extension points and required permissions",
    "",
    "Declarative capabilities go in the manifest's `contributes` (Tier-0, zero JS); the table below lists the registration entry points for JS plugins.",
    "**The permission column is not advisory**: calling something without declaring it in manifest `permissions` throws " +
      "(`used <capability> without declaring it`) — declare the permission first, then write the code.",
    "",
    "| Entry point | Permission | Description |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function renderGroups(
  groups: ContextGroup[],
  scalars: ContextMember[],
  gates: Map<string, string[]>,
): string {
  const parts: string[] = ["## Full PluginContext signature", "", "The signatures below match the `@ccgui/plugin-sdk` source verbatim (types collapsed onto one line).", ""];
  for (const group of groups) {
    parts.push(`### ctx.${group.name}`, "");
    if (group.doc) parts.push(group.doc, "");
    const lines = [`${group.name}: {`];
    for (const member of group.members) {
      const gate = gates.get(`${group.name}.${member.name}`);
      if (gate) lines.push(`  /** Permissions: ${gate.join(", ")} */`);
      lines.push(`  ${member.signature};`);
    }
    lines.push("}");
    parts.push(fenced("ts", lines.join("\n")), "");
  }
  if (scalars.length > 0) {
    parts.push("### Scalar properties", "");
    parts.push(
      fenced(
        "ts",
        scalars
          .map(
            (m) =>
              `ctx.${m.signature};${m.doc ? ` // ${m.doc.length > 160 ? `${m.doc.slice(0, 160)}…` : m.doc}` : ""}`,
          )
          .join("\n"),
      ),
      "",
    );
  }
  return parts.join("\n");
}

function renderPermissions(
  spec: PermissionsSpec,
  gates: Map<string, string[]>,
  bridge: BridgeCommand[],
): string {
  const usedBy = new Map<string, string[]>();
  for (const [path, perms] of gates) {
    for (const perm of perms) {
      usedBy.set(perm, [...(usedBy.get(perm) ?? []), `\`ctx.${path}\``]);
    }
  }
  const shapes = spec.networkGrantShapes;
  return [
    "## Permission catalog",
    "",
    "`manifest.permissions` only accepts the base permissions listed below, or well-formed `network:` / `exec:` grants; " +
      "calling an undeclared capability throws, and an unknown permission means outright rejection at install/load time.",
    "",
    "| Permission | Gated entry point |",
    "|---|---|",
    ...spec.knownPermissions.map(
      (perm) =>
        `| \`${perm}\` | ${(usedBy.get(perm) ?? []).join("、") || "—"} |`,
    ),
    "",
    "### network: / exec: grant shapes",
    "",
    "- `network:<host>` (any port) / `network:<host>:<port>` / `network:<host>:<a>-<b>` (endpoints inclusive, 1–65535). " +
      "The host must match exactly (case-insensitive, no wildcards, subdomains do not match), http/https only." +
      (shapes.valid.length > 0 ? `Valid examples: ${shapes.valid.slice(0, 4).map((v) => `\`${v}\``).join(", ")}.` : ""),
    "- `exec:<bin>`: a bare binary name (`^[A-Za-z0-9._-]+$`, no path separators), matched exactly, case-sensitive.",
    "- `network:none` is a base permission meaning \"this plugin uses no network\" — it is **not** a grant and never allows any host.",
    "- Network access and execution only go through the `ctx.bridge.invoke` command table (extracted from the host implementation below; any unlisted command name is rejected):",
    "",
    "| bridge command | Required grant |",
    "|---|---|",
    ...bridge.map(
      (entry) =>
        `| ${entry.commands.map((c) => `\`${c}\``).join("、")} | ${entry.grants.join("、") || "—"} |`,
    ),
    "",
  ].join("\n");
}

function fenced(lang: string, body: string): string {
  return ["```" + lang, body, "```"].join("\n");
}

/** 生成 skill 内需要脚本维护的全部文件（内容确定：同输入必然同字节）。 */
export function buildCreatorSkillFiles(repoRoot = repoRootFromHere()): SkillDocFile[] {
  const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");
  const sdkDir = "packages/plugin-sdk/src";

  const manifestSource = parse(`${sdkDir}/manifest.ts`, read(`${sdkDir}/manifest.ts`));
  const contextSource = parse(`${sdkDir}/context.ts`, read(`${sdkDir}/context.ts`));
  const hostContextPath = "src/features/plugins/runtime/context.ts";
  const hostContextSource = parse(hostContextPath, read(hostContextPath));

  const sdkVersion = extractSdkVersion(path.join(repoRoot, `${sdkDir}/version.ts`));
  const manifestFields = extractManifest(manifestSource);
  const activateReturn = extractActivateReturn(manifestSource);
  const { groups, scalars } = extractContextGroups(contextSource);
  const gates = extractPermissionGates(hostContextSource);
  const bridge = extractBridgeCommands(hostContextSource);
  const permissions = readPermissionsSpec(path.join(repoRoot, "packages/plugin-sdk/spec/permissions.json"));

  const sdkDoc = [
    renderHeader(sdkVersion),
    renderManifest(manifestFields, activateReturn),
    renderExtensionTable(groups, gates),
    renderGroups(groups, scalars, gates),
    renderPermissions(permissions, gates, bridge),
  ].join("\n");

  return [{ path: GENERATED_SDK_DOC, content: sdkDoc }];
}
