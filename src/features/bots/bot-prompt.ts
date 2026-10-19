import type { BotConfig } from "@/lib/ipc";

/**
 * Bot → system prompt. One pure function is the single source of truth for
 * both the outgoing prompt (send path) and the editor's 拼装预览 drawer, so
 * what the user reads is what the model gets.
 *
 * Block order is fixed (plan §6.1); empty blocks are dropped whole, never
 * emitted as an empty heading. Limits are advisory: the store never truncates
 * SOUL/AGENTS, it reports the overrun so the editor can say so.
 */

/** Minimal BotConfig for a read-only built-in catalog pick, which arrives as
 *  a name + prompt and has none of the bot machinery (skills, memory, …). */
export function builtInBotShell(name: string, prompt: string): BotConfig {
  return {
    id: "builtin",
    slug: "builtin",
    name,
    title: null,
    description: null,
    avatar: { type: "generated" },
    soul: prompt,
    instructions: "",
    capabilities: { skills: [], tools: [], mcpServers: [] },
    runtime: {
      kind: "direct",
      model: null,
      cwd: null,
      extraArgs: [],
      permissionMode: "ask",
    },
    memory: {
      enabled: false,
      writeApproval: false,
      memoryCharLimit: 2200,
      reviewEnabled: false,
      reviewEveryNTurns: 5,
    },
    source: "builtin",
    builtinId: null,
    pinned: false,
    hidden: false,
    schemaVersion: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** SOUL + AGENTS share this budget; the editor warns above 80% of it. */
export const PROSE_LIMIT = 10_000;
/** Skills *index* budget (name + description only, not the skill bodies). */
export const SKILL_INDEX_LIMIT = 3_000;
/** The global USER profile's budget (per plan §8.1). */
export const USER_LIMIT = 1_375;

export type PromptBlockId =
  | "app"
  | "identity"
  | "soul"
  | "instructions"
  | "user"
  | "memory"
  | "skills"
  | "memoryGuide"
  | "collaborators";

export interface PromptBlock {
  id: PromptBlockId;
  /** Heading as it appears in the prompt ("你的身份"), empty for `app`. */
  title: string;
  text: string;
  chars: number;
  /** Usage ceiling of this block, when it has one. */
  limit?: number;
  /** True when the block contributes nothing and is left out entirely. */
  omitted: boolean;
  /** Set when the block is waiting on a later phase (协作者 / 定时任务 …):
   *  the preview shows 即将支持 instead of pretending the user left it
   *  empty. Memory no longer uses this — its guide is gated by
   *  `memoryAvailable` instead. */
  planned?: number;
  /**
   * `external` blocks belong to the host CLI (its own system prompt) and are
   * shown in the preview for context but are not part of what we build.
   */
  external?: boolean;
  /** First non-empty line, for the preview drawer's one-line summary. */
  preview: string;
}

export interface AssembledPrompt {
  blocks: PromptBlock[];
  /** Everything the bot contributes (metadata lines included). */
  text: string;
  /** Chars of the bot-owned blocks; the host prompt is not counted. */
  totalChars: number;
}

export interface SkillIndexEntry {
  name: string;
  description: string;
}

export interface CollaboratorEntry {
  slug: string;
  description: string;
}

export interface AssembleInput {
  bot: BotConfig;
  /** Localised heading of the host's own system prompt (preview only). */
  appPromptLabel?: string;
  appPromptChars?: number;
  /** Global USER profile, already rendered as `- item` lines. */
  user?: string;
  /** This bot's MEMORY, already rendered as `- item` lines. */
  memory?: string;
  /**
   * Whether the `memory` tool is mounted for this session. Default false:
   * on engines that cannot mount it, injecting the guide would instruct the
   * model to call a tool it cannot call. The tool exists in this build
   * (memory/mcp.rs); the flag is per-engine.
   */
  memoryAvailable?: boolean;
  /** Phase of the memory feature, for the preview's badge. */
  memoryPhase?: number;
  /** Every skill this bot may use (already filtered by its capability list). */
  skills?: SkillIndexEntry[];
  collaborators?: CollaboratorEntry[];
}

/** The fixed 记忆使用说明 body injected when memory is on (plan §8.4). The
 *  heading comes from the block title, so the constant must not carry one of
 *  its own — a duplicated `# 记忆使用说明` is a real tell that the model is
 *  being handed two competing instructions. */
export const MEMORY_GUIDE = `You have persistent memory, visible in future conversations. Manage it with the \`memory\` tool.
Note: saying "I got it" saves nothing — you must actually call the tool.

## Save proactively (don't wait to be asked)
- The user expresses a preference or habit → target=user
- The user corrects you ("no, do it like this…") → store the right way in target=memory
- You hit a pitfall and found the fix (error cause + fix) → target=memory
- Stable facts about the project or environment: paths, stack, commands, conventions → target=memory
- Finished important work (date + what was done) → target=memory
- The user explicitly says "remember…" → save immediately

## Do NOT save
- Trivial, fuzzy information (e.g. "user asked about Python")
- Public knowledge you can look up
- Large code blocks, logs, tables
- Information that only matters to this session
- Anything already in the "persona" or "working rules"
- Any secrets, passwords, tokens

## Style
- Keep every entry dense: concrete paths, commands, reasons
- Over 80% usage, merge similar entries before adding
- When an entry goes stale, replace or remove it`;

function countChars(text: string): number {
  return [...text].length;
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

/**
 * Identity block: what other bots read when they consider delegating, and
 * what the model reads to know who it is. Only non-empty parts are listed.
 */
export function identityText(bot: Pick<BotConfig, "name" | "title" | "description">): string {
  const lines = [`You are "${bot.name}".`];
  if (bot.title?.trim()) lines.push(`Title: ${bot.title.trim()}`);
  if (bot.description?.trim()) lines.push(`About: ${bot.description.trim()}`);
  return lines.join("\n");
}

/**
 * Skills index: name + description only. Truncation is by list order and
 * always leaves a pointer to the rest — the model can still ask for them.
 */
export function skillsIndexText(skills: SkillIndexEntry[]): { text: string; truncated: number } {
  const lines: string[] = [];
  let used = 0;
  let truncated = 0;
  for (const [index, skill] of skills.entries()) {
    const line = `- ${skill.name}: ${skill.description}`;
    const cost = countChars(line) + 1;
    if (used + cost > SKILL_INDEX_LIMIT) {
      truncated = skills.length - index;
      break;
    }
    lines.push(line);
    used += cost;
  }
  if (truncated > 0) {
    lines.push(`- ${truncated} more skill(s), see skill_list`);
  }
  return { text: lines.join("\n"), truncated };
}

function collaboratorsText(collaborators: CollaboratorEntry[]): string {
  return collaborators
    .filter((c) => c.slug.trim())
    .map((c) => (c.description.trim() ? `- @${c.slug}: ${c.description.trim()}` : `- @${c.slug}`))
    .join("\n");
}

/**
 * Assemble the bot's contribution to the system prompt.
 *
 * The host's own prompt is reported as an `external` block so the preview can
 * show the whole picture (plan §6.1 block 1) without pretending we author it.
 */
export function assembleBotPrompt(input: AssembleInput): AssembledPrompt {
  const { bot } = input;
  const memoryOn = bot.memory.enabled !== false;
  const memoryAvailable = input.memoryAvailable === true;
  const skills = skillsIndexText(
    (input.skills ?? []).filter((skill) => skill.name.trim().length > 0),
  );
  const collaborators = collaboratorsText(input.collaborators ?? []);

  const drafts: Array<{
    id: PromptBlockId;
    title: string;
    body: string;
    limit?: number;
    planned?: number;
  }> = [
    {
      id: "identity",
      title: "Your identity",
      body: identityText(bot),
    },
    { id: "soul", title: "Your persona", body: (bot.soul ?? "").trim() },
    { id: "instructions", title: "Working rules", body: (bot.instructions ?? "").trim() },
    { id: "user", title: "About the user (USER)", body: (input.user ?? "").trim(), limit: USER_LIMIT },
    {
      id: "memory",
      title: "Your notes (MEMORY)",
      body: (input.memory ?? "").trim(),
      limit: bot.memory.memoryCharLimit,
    },
    { id: "skills", title: "Available skills", body: skills.text, limit: SKILL_INDEX_LIMIT },
    {
      id: "memoryGuide",
      title: "Memory usage guide",
      body: memoryOn && memoryAvailable ? MEMORY_GUIDE : "",
      planned: memoryOn && !memoryAvailable ? (input.memoryPhase ?? 2) : undefined,
    },
    { id: "collaborators", title: "Collaborators", body: collaborators },
  ];

  const blocks: PromptBlock[] = drafts.map((draft) => ({
    id: draft.id,
    title: draft.title,
    text: draft.body,
    chars: countChars(draft.body),
    limit: draft.limit,
    omitted: draft.body.length === 0,
    planned: draft.planned,
    preview: firstLine(draft.body),
  }));

  const head = [
    {
      id: "app" as const,
      title: input.appPromptLabel ?? "App base system prompt",
      text: "",
      chars: input.appPromptChars ?? 0,
      omitted: false,
      external: true,
      preview: "Provided by the current engine, not generated from Bot config",
    },
    ...blocks,
  ];

  const body = blocks
    .filter((block) => !block.omitted)
    .map((block) => `# ${block.title}\n${block.text}`)
    .join("\n\n");

  return {
    blocks: head,
    text: body,
    totalChars: countChars(body),
  };
}

/** True once SOUL + AGENTS exceed the shared budget — the editor's red state. */
export function proseOverLimit(bot: Pick<BotConfig, "soul" | "instructions">): boolean {
  return countChars(bot.soul ?? "") + countChars(bot.instructions ?? "") > PROSE_LIMIT;
}

/**
 * Phrases that appear in both SOUL and AGENTS: the model reads them twice, so
 * the editor nudges the user to keep each statement in one place. Cheap
 * heuristic on purpose — it only produces a hint, never a block.
 *
 * Lines shorter than six code points are ignored: bullets like "说人话" or
 * "1." would otherwise fire on ordinary prose, and a hint that cries wolf is
 * worse than no hint.
 */
export function duplicateProseLines(
  bot: Pick<BotConfig, "soul" | "instructions">,
): string[] {
  const normalize = (line: string) => line.replace(/^[-*\d.\s]+/, "").trim();
  const significant = (line: string) => line.length >= 6;
  const soulLines = new Set(
    (bot.soul ?? "")
      .split("\n")
      .map(normalize)
      .filter(significant),
  );
  return (bot.instructions ?? "")
    .split("\n")
    .map(normalize)
    .filter((line) => significant(line) && soulLines.has(line));
}
