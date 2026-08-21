import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PenaltyRule } from "../../lib/api/generated/client";
import { TriggeredPenaltiesList } from "./TriggeredPenaltiesList";

function buildRule(id: string, name: string, threshold: number): PenaltyRule {
  return {
    id,
    teamId: "team-1",
    name,
    threshold,
    createdAt: "2026-08-21T00:00:00Z",
    updatedAt: "2026-08-21T00:00:00Z",
  };
}

describe("TriggeredPenaltiesList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows triggered penalties in descending threshold order", () => {
    render(
      <TriggeredPenaltiesList
        triggeredPenaltyRuleIds={["rule-low", "rule-high"]}
        rules={[
          buildRule("rule-low", "小さなペナルティ", 3),
          buildRule("rule-high", "大きなペナルティ", 10),
        ]}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("大きなペナルティ");
    expect(items[0]).toHaveTextContent("発動しきい値: 10");
    expect(items[1]).toHaveTextContent("小さなペナルティ");
    expect(items[1]).toHaveTextContent("発動しきい値: 3");
  });

  it("keeps the existing empty and unknown-rule states", () => {
    const { rerender } = render(
      <TriggeredPenaltiesList triggeredPenaltyRuleIds={[]} rules={[]} />,
    );

    expect(
      screen.getByText("発動ペナルティはありません。"),
    ).toBeInTheDocument();

    rerender(
      <TriggeredPenaltiesList
        triggeredPenaltyRuleIds={["missing-rule"]}
        rules={[]}
      />,
    );

    expect(screen.getByText("不明なルール (missing-rule)")).toBeInTheDocument();
    expect(screen.getByText("ルール詳細を確認できません")).toBeInTheDocument();
  });
});
