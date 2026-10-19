/**
 * 能力目录：AI 只能组合「已声明」的能力；已声明但未接入的能力会被校验
 * 标成「缺少能力，不可运行」，绝不伪装执行（方案 §4.3 / §8）。
 *
 * provider 含义：
 *  - "simulated"：已实现但只做本地模拟，不访问外部系统（内置示例流程使用；
 *    UI 必须明示「演示」）。
 *  - "native"：真实接入宿主能力（第一版还没有工具类原生能力）。
 *  - "unavailable"：目录中声明、尚未接入——可被流程引用，但校验直接判
 *    不可运行。
 */

export type MissionCapabilityKind = "input" | "tool";
export type MissionCapabilityProvider = "simulated" | "native" | "unavailable";

export interface MissionCapabilityParam {
  type: "string" | "number" | "boolean";
  required?: boolean;
  description: string;
}

export interface MissionCapability {
  id: string;
  kind: MissionCapabilityKind;
  title: string;
  description: string;
  provider: MissionCapabilityProvider;
  params: Record<string, MissionCapabilityParam>;
  /** 结果形状说明，供 AI 提示与校验提示使用。 */
  resultKind: "collection" | "record";
}

export const MISSION_CAPABILITIES: readonly MissionCapability[] = [
  {
    id: "demo.repo.pullRequests",
    kind: "input",
    title: "Read open PRs in the repo",
    description: "Provide the PR set to process (demo data, no GitHub access)",
    provider: "simulated",
    params: {
      count: { type: "number", required: true, description: "PR count (1–100)" },
      seed: { type: "number", description: "Demo data seed" },
    },
    resultKind: "collection",
  },
  {
    id: "demo.ci.check",
    kind: "tool",
    title: "CI / evidence check",
    description: "Deterministic check of one input (demo: simulated locally, no CI access)",
    provider: "simulated",
    params: {},
    resultKind: "record",
  },
  {
    id: "demo.feedback.list",
    kind: "input",
    title: "Read feedback to classify",
    description: "Provide the customer feedback set to classify (demo data)",
    provider: "simulated",
    params: {
      count: { type: "number", required: true, description: "Feedback count (1–100)" },
      seed: { type: "number", description: "Demo data seed" },
    },
    resultKind: "collection",
  },
  {
    id: "demo.classify.check",
    kind: "tool",
    title: "Classification evidence check",
    description: "Verify feedback classification evidence (demo: simulated locally)",
    provider: "simulated",
    params: {},
    resultKind: "record",
  },
  {
    id: "demo.notes.list",
    kind: "input",
    title: "Read reference list",
    description: "Provide the reference set to organize (demo data)",
    provider: "simulated",
    params: {
      count: { type: "number", required: true, description: "Reference count (1–100)" },
      seed: { type: "number", description: "Demo data seed" },
    },
    resultKind: "collection",
  },
  {
    id: "demo.docs.verify",
    kind: "tool",
    title: "Reference evidence check",
    description: "Verify evidence in the materials (demo: simulated locally)",
    provider: "simulated",
    params: {},
    resultKind: "record",
  },
  {
    id: "github.pr.comment",
    kind: "tool",
    title: "Comment on PR",
    description: "Write a comment to GitHub (not connected yet)",
    provider: "unavailable",
    params: {
      body: { type: "string", required: true, description: "Comment body" },
    },
    resultKind: "record",
  },
  {
    id: "github.pr.merge",
    kind: "tool",
    title: "Merge PR",
    description: "Merge code (not connected yet; this workbench never writes externally by default)",
    provider: "unavailable",
    params: {},
    resultKind: "record",
  },
  {
    id: "im.sendMessage",
    kind: "tool",
    title: "Send message to external system",
    description: "Send a message to an external IM/ticketing system (not connected yet)",
    provider: "unavailable",
    params: {
      target: { type: "string", required: true, description: "Target conversation" },
      text: { type: "string", required: true, description: "Message body" },
    },
    resultKind: "record",
  },
];

export function findCapability(id: string | undefined): MissionCapability | undefined {
  if (!id) return undefined;
  return MISSION_CAPABILITIES.find((capability) => capability.id === id);
}

/** 能力是否可执行：已实现（模拟或原生）都算；unavailable 不算。 */
export function isCapabilityRunnable(capability: MissionCapability | undefined): boolean {
  return capability !== undefined && capability.provider !== "unavailable";
}

/** AI 提示用：能力目录的紧凑文本描述。 */
export function capabilityCatalogPrompt(): string {
  return MISSION_CAPABILITIES.map((capability) => {
    const params = Object.entries(capability.params)
      .map(([name, param]) => `${name}:${param.type}${param.required ? "!" : ""}`)
      .join(",");
    const state =
      capability.provider === "unavailable"
        ? "unavailable"
        : capability.provider === "simulated"
          ? "demo"
          : "connected";
    return `- ${capability.id} (${capability.kind}, ${state}) ${capability.title}${params ? ` [${params}]` : ""}`;
  }).join("\n");
}
