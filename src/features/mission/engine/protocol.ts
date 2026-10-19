import { capabilityCatalogPrompt } from "../catalog";
import type {
  MissionAgentConfig,
  MissionFlowDefinition,
  MissionFlowEdge,
  MissionFlowNode,
  MissionNodeType,
} from "../types";
import type { MissionValidationIssue } from "./validator";
import { hasBlockingIssues, validateMissionFlow } from "./validator";

/**
 * AI 编排协议（M3）：AI 生成结构化流程描述（JSON），程序做两级校验后
 * 才更新草稿。AI 不生成图片/JSX/代码——只生成这个 JSON。
 *
 * 响应格式（放在 ```json 代码块里）：
 * {
 *   "reply": "给用户的一段说明",
 *   "definition": { MissionFlowDefinition } | null
 * }
 * definition 为 null 表示只回答问题、不改流程。
 */

export interface MissionProposal {
  reply: string;
  definition: MissionFlowDefinition | null;
}

export interface MissionProposalResult {
  ok: boolean;
  proposal?: MissionProposal;
  /** 解析/校验失败的细节（用户可见的 issue 列表）。 */
  issues?: MissionValidationIssue[];
  error?: string;
}

const NODE_TYPES: readonly MissionNodeType[] = [
  "input",
  "tool",
  "agent",
  "foreach",
  "human",
  "output",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asParams(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** 从模型输出中提取最后一个 JSON 代码块或平衡花括号对象。 */
export function extractJsonCandidate(text: string): string | null {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  if (fenced.length > 0) {
    return fenced[fenced.length - 1][1].trim();
  }
  // 无围栏：找最后一个平衡的顶层对象（跳过字符串内的括号）。
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let candidate: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) candidate = text.slice(start, index + 1);
      if (depth < 0) depth = 0;
    }
  }
  return candidate;
}

interface NormalizeResult<T> {
  value: T | null;
  issueCodes: string[];
}

function parseAgentConfig(value: unknown): MissionAgentConfig | null {
  if (!isRecord(value)) return null;
  const instruction = asString(value.instruction);
  if (instruction === null || instruction.trim() === "") return null;
  return {
    instruction,
    inputs: Array.isArray(value.inputs)
      ? value.inputs.filter((item): item is string => typeof item === "string")
      : undefined,
    readOnly: value.readOnly === true,
    provider: value.provider === "simulated" ? "simulated" : "native",
  };
}

function parseNode(value: unknown): MissionFlowNode | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const type = asString(value.type) as MissionNodeType | null;
  const title = asString(value.title);
  if (!id || !title || !type || !NODE_TYPES.includes(type)) return null;
  const position = isRecord(value.position)
    ? { x: asNumber(value.position.x, 0), y: asNumber(value.position.y, 0) }
    : { x: 0, y: 0 };
  const node: MissionFlowNode = {
    id,
    type,
    title,
    description: asString(value.description) ?? undefined,
    position,
  };
  switch (type) {
    case "input": {
      const input = isRecord(value.input) ? value.input : null;
      const capabilityId = input ? asString(input.capabilityId) : null;
      if (!capabilityId) return null;
      node.input = { capabilityId, params: asParams(input?.params) };
      break;
    }
    case "tool": {
      const tool = isRecord(value.tool) ? value.tool : null;
      const capabilityId = tool ? asString(tool.capabilityId) : null;
      if (!capabilityId) return null;
      node.tool = { capabilityId, params: asParams(tool?.params) };
      break;
    }
    case "agent": {
      const agent = parseAgentConfig(value.agent);
      if (!agent) return null;
      node.agent = agent;
      break;
    }
    case "human": {
      const human = isRecord(value.human) ? value.human : null;
      const ask = human ? asString(human.ask) : null;
      if (!ask) return null;
      node.human = { ask };
      break;
    }
    case "output": {
      const output = isRecord(value.output) ? value.output : null;
      const artifact = output ? asString(output.artifact) : null;
      if (!artifact) return null;
      node.output = { artifact };
      break;
    }
    case "foreach": {
      const foreach = isRecord(value.foreach) ? value.foreach : null;
      if (!foreach) return null;
      const over = asString(foreach.over);
      const body = isRecord(foreach.body) ? foreach.body : null;
      if (!over || !body || !Array.isArray(body.nodes)) return null;
      const bodyNodes: MissionFlowNode[] = [];
      for (const child of body.nodes) {
        const parsed = parseNode(child);
        if (parsed) bodyNodes.push(parsed);
      }
      const bodyEdges: MissionFlowEdge[] = [];
      if (Array.isArray(body.edges)) {
        body.edges.forEach((edge, index) => {
          const parsed = parseEdge(edge, index);
          if (parsed) bodyEdges.push(parsed);
        });
      }
      node.foreach = {
        over,
        concurrency: asNumber(foreach.concurrency, 5),
        body: {
          // 子流程里再出现 foreach 属于超出第一版边界；将被校验拒绝。
          nodes: bodyNodes,
          edges: bodyEdges,
        },
      };
      break;
    }
  }
  return node;
}

function parseEdge(value: unknown, index: number): MissionFlowEdge | null {
  if (!isRecord(value)) return null;
  const from = asString(value.from);
  const to = asString(value.to);
  if (!from || !to) return null;
  return {
    id: asString(value.id) ?? `e-${from}-${to}-${index}`,
    from,
    to,
    label: asString(value.label) ?? undefined,
    condition: asString(value.condition) ?? undefined,
    kind:
      value.kind === "recovery" || value.kind === "feedback" ? value.kind : "flow",
  };
}

/** 结构归一化（schema 层）：类型守卫 + 默认值，不判断业务合理性。 */
export function parseMissionFlowDefinition(value: unknown): NormalizeResult<MissionFlowDefinition> {
  const issueCodes: string[] = [];
  if (!isRecord(value)) return { value: null, issueCodes: ["emptyFlow"] };
  const settings = isRecord(value.settings) ? value.settings : {};
  const approval = asString(settings.approval);
  const nodes: MissionFlowNode[] = [];
  if (Array.isArray(value.nodes)) {
    for (const raw of value.nodes) {
      const node = parseNode(raw);
      if (node) nodes.push(node);
      else issueCodes.push("missingConfig");
    }
  }
  const edges: MissionFlowEdge[] = [];
  if (Array.isArray(value.edges)) {
    value.edges.forEach((raw, index) => {
      const edge = parseEdge(raw, index);
      if (edge) edges.push(edge);
    });
  }
  if (nodes.length === 0) issueCodes.push("emptyFlow");
  if (edges.length === 0 && nodes.length > 1) issueCodes.push("missingUpstream");

  return {
    value: {
      version: 1,
      name: asString(value.name)?.trim() || "Untitled flow",
      goal: asString(value.goal)?.trim() || "",
      settings: {
        concurrency: asNumber(settings.concurrency, 5),
        retries: asNumber(settings.retries, 1),
        approval: approval === "all" || approval === "none" ? approval : "risk",
        verification: settings.verification !== false,
      },
      nodes,
      edges,
    },
    issueCodes,
  };
}

/** 解析并校验模型输出；错误不抛出，交给调用方如实展示。 */
export function parseMissionProposal(text: string): MissionProposalResult {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return { ok: false, error: "no-json" };
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    return { ok: false, error: "bad-json" };
  }
  if (!isRecord(raw)) return { ok: false, error: "bad-shape" };
  const reply = asString(raw.reply) ?? "";
  if (raw.definition === null || raw.definition === undefined) {
    return { ok: true, proposal: { reply, definition: null } };
  }
  const normalized = parseMissionFlowDefinition(raw.definition);
  if (!normalized.value) {
    return {
      ok: false,
      error: "bad-definition",
      issues: normalized.issueCodes.map((code) => ({
        code,
        severity: "error",
        params: {},
      })),
    };
  }
  const issues = validateMissionFlow(normalized.value);
  if (hasBlockingIssues(issues)) {
    return { ok: false, error: "invalid", issues };
  }
  return { ok: true, proposal: { reply, definition: normalized.value } };
}

// ── 变更摘要（修改而非重画：保留原节点 ID） ────────────────────────────────

export interface MissionChangeLine {
  key: string;
  params?: Record<string, string | number>;
}

function nodeMap(definition: MissionFlowDefinition): Map<string, MissionFlowNode> {
  const map = new Map<string, MissionFlowNode>();
  for (const node of definition.nodes) {
    map.set(node.id, node);
    for (const child of node.foreach?.body.nodes ?? []) {
      map.set(`${node.id}/${child.id}`, child);
    }
  }
  return map;
}

function edgeKeys(definition: MissionFlowDefinition): Set<string> {
  const keys = new Set<string>();
  for (const edge of definition.edges) keys.add(`${edge.from}->${edge.to}`);
  for (const node of definition.nodes) {
    for (const edge of node.foreach?.body.edges ?? []) {
      keys.add(`${node.id}:${edge.from}->${edge.to}`);
    }
  }
  return keys;
}

/** 生成变更摘要（最多 8 条）；previous 为 null 表示首次生成。 */
export function diffMissionDefinitions(
  previous: MissionFlowDefinition | null,
  next: MissionFlowDefinition,
): MissionChangeLine[] {
  const lines: MissionChangeLine[] = [];
  if (previous) {
    if (previous.settings.concurrency !== next.settings.concurrency) {
      lines.push({
        key: "changeConcurrency",
        params: { from: previous.settings.concurrency, to: next.settings.concurrency },
      });
    }
    if (previous.settings.retries !== next.settings.retries) {
      lines.push({
        key: "changeRetries",
        params: { from: previous.settings.retries, to: next.settings.retries },
      });
    }
    if (previous.settings.approval !== next.settings.approval) {
      lines.push({
        key:
          next.settings.approval === "all"
            ? "changeApprovalAll"
            : next.settings.approval === "none"
              ? "changeApprovalNone"
              : "changeApprovalRisk",
      });
    }
    if (previous.settings.verification !== next.settings.verification) {
      lines.push({
        key: next.settings.verification ? "changeVerificationOn" : "changeVerificationOff",
      });
    }
  }
  const before = previous ? nodeMap(previous) : new Map<string, MissionFlowNode>();
  const after = nodeMap(next);
  for (const [key, node] of after) {
    const old = before.get(key);
    if (!old) lines.push({ key: "changeNodeAdded", params: { title: node.title } });
    else if (JSON.stringify(old) !== JSON.stringify(node)) {
      lines.push({ key: "changeNodeUpdated", params: { title: node.title } });
    }
  }
  for (const [key, node] of before) {
    if (!after.has(key)) lines.push({ key: "changeNodeRemoved", params: { title: node.title } });
  }
  const oldEdges = previous ? edgeKeys(previous) : new Set<string>();
  const newEdges = edgeKeys(next);
  if (oldEdges.size !== newEdges.size || [...newEdges].some((key) => !oldEdges.has(key))) {
    lines.push({ key: "changeEdges", params: { count: newEdges.size } });
  }
  if (previous && previous.name !== next.name) {
    lines.push({ key: "changeName", params: { name: next.name } });
  }
  return lines.slice(0, 8);
}

// ── 提示词 ────────────────────────────────────────────────────────────────

export interface ProposalPromptInput {
  flowName: string;
  flowGoal: string;
  draft: MissionFlowDefinition | null;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  message: string;
}

/** 组装给宿主 agent 的编排提示词（能力目录 + 草稿 + 修改要求）。 */
export function buildMissionProposalPrompt(input: ProposalPromptInput): string {
  const history = input.history
    .slice(-6)
    .map((item) => `${item.role === "user" ? "user" : "assistant"}: ${item.text}`)
    .join("\n");
  const draft = input.draft ? JSON.stringify(input.draft, null, 2) : "(no draft yet)";
  return [
    "You are the flow orchestrator for the task workbench. The user describes a goal in natural language; turn it into a structured flow JSON.",
    "",
    "Hard rules:",
    "1. Output exactly one JSON object inside a ```json code block; the structure must be:",
    '   { "reply": "a note to the user in English", "definition": { ... } }，',
    "   Use null for definition when not changing the flow. Do not output flow content outside the JSON.",
    "2. capabilityId must come from the capability catalog below; do not invent tool ids. Capabilities marked unavailable may stay in the flow — the program will mark them non-runnable; never pretend they work.",
    "3. There are only 6 node types: input / tool / agent / foreach / human / output.",
    "4. When editing an existing draft, keep the original node ids (modify, don’t redraw); position may be {x:0,y:0}, the program lays out automatically.",
    "5. All branches must converge into output; foreach’s over must be its upstream node.",
    "6. Agent nodes with read-only requirements set readOnly: true; do not declare permissions outside the flow, and do not generate merge-code, comment-posting, or external-write steps (unless the catalog explicitly marks them available).",
    "",
    "Capability catalog:",
    capabilityCatalogPrompt(),
    "",
    "Node JSON shapes (pick fields by type):",
    '- input:  {"id":"source","type":"input","title":"…","input":{"capabilityId":"…","params":{}}}',
    '- tool:   {"id":"check","type":"tool","title":"…","tool":{"capabilityId":"…"}}',
    '- agent:  {"id":"analyze","type":"agent","title":"…","agent":{"instruction":"…","readOnly":true}}',
    '- human:  {"id":"confirm","type":"human","title":"…","human":{"ask":"…"}}',
    '- output: {"id":"summary","type":"output","title":"…","output":{"artifact":"…"}}',
    "- foreach: {\"id\":\"review\",\"type\":\"foreach\",\"title\":\"…\",\"foreach\":{\"over\":\"source\",\"concurrency\":5,\"body\":{\"nodes\":[…],\"edges\":[{\"id\":\"e1\",\"from\":\"…\",\"to\":\"…\",\"condition\":\"key=value\"}]}}}",
    "  Edge conditions support only `key=value` / `key!=value`, combined with and/or; `default` means when no other condition matches.",
    "  Available context values: upstream output fields (e.g. risk), run settings (approval, verification, concurrency, retries).",
    "",
    `Flow name: ${input.flowName || "Untitled flow"}`,
    `Goal: ${input.flowGoal || input.message}`,
    "",
    "Current draft:",
    "```json",
    draft,
    "```",
    "",
    history ? `Recent conversation:\n${history}\n` : "",
    `Latest user message: ${input.message}`,
  ].join("\n");
}
