import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import {
  COMPACT_COMMAND_TEXT,
  isCompactCommandRow,
  isResumeNudgeRow,
} from "./internal-rows";

describe("host compaction rows", () => {
  it("recognises the compaction command, whatever the session replay spelled", () => {
    expect(isCompactCommandRow({ role: "user", text: COMPACT_COMMAND_TEXT })).toBe(true);
    expect(isCompactCommandRow({ role: "user", text: " /compact " })).toBe(true);
    expect(isCompactCommandRow({ role: "user", text: "/compact 之后再继续" })).toBe(false);
    expect(isCompactCommandRow({ role: "assistant", text: COMPACT_COMMAND_TEXT })).toBe(false);
    expect(isCompactCommandRow({ role: "tool", text: COMPACT_COMMAND_TEXT })).toBe(false);
  });

  it("recognises the resume nudge", () => {
    expect(isResumeNudgeRow({ role: "user", text: en.chat.autoCompactResume })).toBe(true);
  });

  // The nudge goes through the ordinary send path, which appends extra text
  // (a frozen agent block) when one is selected — the row text carries it too.
  it("still recognises a nudge that carries appended text", () => {
    expect(
      isResumeNudgeRow({
        role: "user",
        text: `${en.chat.autoCompactResume}\n\nYou are the review engineer.`,
      }),
    ).toBe(true);
  });

  it("keeps ordinary user text and non-user rows", () => {
    expect(isResumeNudgeRow({ role: "user", text: "帮我压一下上下文" })).toBe(false);
    expect(isResumeNudgeRow({ role: "assistant", text: en.chat.autoCompactResume })).toBe(false);
  });
});
