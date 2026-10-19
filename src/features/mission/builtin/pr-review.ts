import type { MissionFlowDefinition } from "../types";
import { layoutMissionFlow } from "../engine/layout";

/**
 * 内置演示流程：全仓 PR 审查与风险分流。
 *
 * 安全边界（方案 §2）：只形成审查意见，不合并 PR、不发表评论、不访问
 * 外部系统；输入与核查均为本地演示数据（catalog 中 provider=simulated）。
 */
export const PR_REVIEW_FLOW_ID = "flow-builtin-pr-review";

export function buildPrReviewDemoFlow(): MissionFlowDefinition {
  const definition: MissionFlowDefinition = {
    version: 1,
    name: "Repo-wide PR review and risk triage",
    goal:
      "Review all open PRs in this project, up to 5 concurrent. Check changes, tests, and permission risk per PR; file review notes for low risk, ask me to confirm high risk. Retry on failure, then summarize. Never auto-merge.",
    settings: {
      concurrency: 5,
      retries: 1,
      approval: "risk",
      verification: true,
    },
    nodes: [
      {
        id: "source",
        type: "input",
        title: "Read open PRs in the repo",
        description: "Fix the scope for this run (demo data, no GitHub access)",
        position: { x: 0, y: 0 },
        input: {
          capabilityId: "demo.repo.pullRequests",
          params: { count: 30, seed: 1 },
        },
      },
      {
        id: "review",
        type: "foreach",
        title: "Review items independently",
        description: "Each PR gets its own context, expanded into standalone tasks at runtime",
        position: { x: 0, y: 0 },
        foreach: {
          over: "source",
          concurrency: 5,
          body: {
            nodes: [
              {
                id: "analyze",
                type: "agent",
                title: "Agent analyzes changes and risk",
                description: "Review code, tests, and permission boundaries per item (demo: no real model calls)",
                position: { x: 0, y: 0 },
                agent: {
                  instruction:
                    "Review this item\u2019s code, test, and permission risk; output review notes only, do not modify any files.",
                  readOnly: true,
                  provider: "simulated",
                },
              },
              {
                id: "verify",
                type: "tool",
                title: "CI / evidence check",
                description: "Deterministic check, separate from AI judgment (demo)",
                position: { x: 0, y: 0 },
                tool: { capabilityId: "demo.ci.check" },
              },
              {
                id: "route",
                type: "agent",
                title: "Triage by risk",
                description: "High risk goes to human confirmation, low risk gets filed",
                position: { x: 0, y: 0 },
                agent: {
                  instruction: "Rate this item\u2019s risk level: high if it touches permissions or security boundaries, otherwise low.",
                  readOnly: true,
                  provider: "simulated",
                },
              },
              {
                id: "review_human",
                type: "human",
                title: "Wait for business decision",
                description: "Doesn\u2019t occupy a concurrency slot; other tasks continue",
                position: { x: 0, y: 0 },
                human: { ask: "Confirm these review notes, or add requirements and reprocess." },
              },
              {
                id: "archive",
                type: "output",
                title: "Save review notes",
                description: "No external writes",
                position: { x: 0, y: 0 },
                output: { artifact: "Review notes for this item" },
              },
            ],
            edges: [
              { id: "e-analyze-verify", from: "analyze", to: "verify", condition: "verification=true" },
              { id: "e-analyze-route", from: "analyze", to: "route", condition: "verification=false" },
              { id: "e-verify-route", from: "verify", to: "route" },
              {
                id: "e-route-human",
                from: "route",
                to: "review_human",
                label: "High risk",
                condition: "risk=high or approval=all",
              },
              { id: "e-route-archive", from: "route", to: "archive", label: "Low risk" },
            ],
          },
        },
      },
      {
        id: "summary",
        type: "output",
        title: "Review results and exception list",
        description: "Summary is generated only after all branches settle",
        position: { x: 0, y: 0 },
        output: { artifact: "Review results and exception list" },
      },
    ],
    edges: [
      { id: "e-source-review", from: "source", to: "review" },
      { id: "e-review-summary", from: "review", to: "summary" },
    ],
  };
  return layoutMissionFlow(definition);
}
