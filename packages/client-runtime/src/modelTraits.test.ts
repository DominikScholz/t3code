import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getTraitsEffortLevel } from "./modelTraits.ts";

function effort(ids: ReadonlyArray<string>, currentValue: string): ProviderOptionDescriptor {
  return {
    id: "effort",
    label: "Effort",
    type: "select",
    options: ids.map((id) => ({ id, label: id })),
    currentValue,
  };
}

describe("getTraitsEffortLevel", () => {
  it("places known efforts within the model's own range regardless of list order", () => {
    const level = (ids: ReadonlyArray<string>, value: string) =>
      getTraitsEffortLevel({ descriptor: effort(ids, value), ultrathinkPromptControlled: false });

    expect(level(["low", "medium", "high", "max"], "low")).toBe(0);
    expect(level(["low", "medium", "high", "max"], "max")).toBe(1);
    expect(level(["xhigh", "high", "medium", "low"], "xhigh")).toBe(1);
    expect(level(["xhigh", "high", "medium", "low"], "medium")).toBeCloseTo(1 / 3);
    expect(level(["low", "medium", "high", "xhigh", "max", "ultra"], "max")).toBeCloseTo(4 / 5);
  });

  it("ranks ultracode with xhigh and ultrathink with max", () => {
    const claude = ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"];
    const level = (value: string) =>
      getTraitsEffortLevel({
        descriptor: effort(claude, value),
        ultrathinkPromptControlled: false,
      });

    expect(level("ultracode")).toBe(level("xhigh"));
    expect(level("ultrathink")).toBe(1);
    expect(level("max")).toBe(1);
  });

  it("falls back to list order for unknown effort ids", () => {
    expect(
      getTraitsEffortLevel({
        descriptor: effort(["quick", "deep", "deeper"], "deep"),
        ultrathinkPromptControlled: false,
      }),
    ).toBe(0.5);
    expect(
      getTraitsEffortLevel({
        descriptor: effort(["default", "deep"], "default"),
        ultrathinkPromptControlled: false,
      }),
    ).toBe(0);
  });

  it("pins ultrathink to the top", () => {
    expect(
      getTraitsEffortLevel({
        descriptor: effort(["low", "high"], "low"),
        ultrathinkPromptControlled: true,
      }),
    ).toBe(1);
  });
});
