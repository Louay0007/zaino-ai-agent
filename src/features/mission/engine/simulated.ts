import { findCapability } from "../catalog";
import type { MissionExecutor, MissionTaskContext } from "./scheduler";
import type { MissionFlowNode } from "../types";

/**
 * 内置演示执行器（M1）。
 *
 * 重要边界：这里所有的输入、工具与 agent 都是本地确定性模拟，不访问
 * 网络、不调用模型、不读写外部系统；UI 必须把它标成「演示」。真实执行
 * （M3）走宿主 agent 管线，与这里互不混淆。
 *
 * 失败也是确定性的：第 12 项核查在第 1 次尝试失败（自动重试后通过），
 * 第 24 项两次失败后升级为人工恢复——用于完整跑通恢复链路。
 */

const DEMO_TITLES = [
  "Message output integrity",
  "Tool status reclaim",
  "History session restore",
  "Code block copy",
  "Plugin type sync",
  "Window position restore",
  "Shortcut hints",
  "Markdown tables",
  "Permission scopes",
  "Command execution boundaries",
  "External tool authorization",
  "Executor reconnect",
  "Streaming render",
  "Terminal performance",
  "File operation permissions",
  "Test isolation",
  "Result cache",
  "Theme switching",
  "Error log desensitization",
  "Cancel and resume",
  "Multi-window sync",
  "Workspace search",
  "Path boundaries",
  "Settings migration",
  "IME compatibility",
  "Resource cleanup",
  "File preview",
  "Event order",
  "Language switching",
  "Empty-state hints",
];

export interface SimulatedExecutorOptions {
  /** 每个节点的模拟耗时；测试传 0。 */
  delayMs?: number;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function itemIndex(context: MissionTaskContext): number {
  const value = context.item?.value;
  if (value && typeof value === "object" && typeof (value as { index?: unknown }).index === "number") {
    return (value as { index: number }).index;
  }
  const id = context.item?.id ?? "";
  const match = id.match(/(\d+)$/);
  return match ? Number(match[1]) - 1 : 0;
}

interface DemoItem {
  id: string;
  label: string;
  title: string;
  risk: "high" | "low";
  index: number;
}

function buildItems(
  prefix: string,
  count: number,
  titles: readonly string[],
  riskEvery: number,
): DemoItem[] {
  const safeCount = Math.max(1, Math.min(100, Math.floor(count)));
  return Array.from({ length: safeCount }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    label: prefix === "PR" ? `PR #${221 + index}` : `${prefix} ${index + 1}`,
    title: titles[index % titles.length],
    risk: index % riskEvery === 0 ? "high" : "low",
    index,
  }));
}

function numericParam(node: MissionFlowNode, name: string, fallback: number): number {
  const raw = node.input?.params?.[name];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

export function createSimulatedExecutor(options: SimulatedExecutorOptions = {}): MissionExecutor {
  const delayMs = options.delayMs ?? 0;

  return {
    async runInput(node): Promise<unknown> {
      await sleep(delayMs);
      const capability = node.input?.capabilityId;
      switch (capability) {
        case "demo.repo.pullRequests":
          return buildItems("PR", numericParam(node, "count", 30), DEMO_TITLES, 7);
        case "demo.feedback.list":
          return buildItems("feedback", numericParam(node, "count", 12), DEMO_TITLES.slice(3), 5);
        case "demo.notes.list":
          return buildItems("materials", numericParam(node, "count", 3), DEMO_TITLES.slice(10), 3);
        default:
          throw new Error(`simulated input is not implemented: ${String(capability)}`);
      }
    },

    async runTool(node, context): Promise<unknown> {
      await sleep(delayMs);
      const capability = node.tool?.capabilityId;
      const known = findCapability(capability);
      if (!known) throw new Error(`unknown capability: ${String(capability)}`);
      if (known.provider !== "simulated") {
        throw new Error(`capability is not wired for real execution: ${String(capability)}`);
      }
      const item = context.item?.label ?? "run";
      if (capability === "demo.ci.check") {
        const index = itemIndex(context);
        const attempt = context.task.attempt;
        if ((index === 11 && attempt === 1) || (index === 23 && attempt <= 2)) {
          throw new Error(`demo check failed on attempt ${attempt}`);
        }
        return { ok: true, item, note: "Demo check complete", checkedAt: context.run.startedAt };
      }
      return { ok: true, item, note: "Demo check complete" };
    },

    async runAgent(node, context): Promise<unknown> {
      await sleep(delayMs);
      const item = context.item?.value as DemoItem | undefined;
      switch (node.id) {
        case "analyze":
          return {
            simulated: true,
            item: context.item?.label,
            findings: [
              "Change scope and test coverage recorded (demo)",
              "Permissions and security boundaries verified item by item (demo)",
            ],
            risk: item?.risk ?? "low",
          };
        case "route":
          return {
            simulated: true,
            item: context.item?.label,
            risk: item?.risk ?? "high",
            reason:
              item?.risk === "high"
                ? "Demo verdict: touches permission or security boundaries"
                : "Demo verdict: routine change, archivable as filed",
          };
        default:
          return {
            simulated: true,
            item: context.item?.label,
            note: "Simulation complete, no real model called",
            instruction: node.agent?.instruction ?? "",
          };
      }
    },
  };
}
