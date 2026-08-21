import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { TriggeredPenaltiesPanel } from "./TriggeredPenaltiesPanel";

describe("TriggeredPenaltiesPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("links to the previous-month summary and explains the empty state", () => {
    render(
      <MemoryRouter>
        <TriggeredPenaltiesPanel
          triggeredPenaltyRuleIds={[]}
          rules={[]}
          summaryMonth="2026-07"
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "今月のペナルティ" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前月サマリー" })).toHaveAttribute(
      "href",
      "/admin/summary?month=2026-07",
    );
    expect(
      screen.getByText("前月に発動したペナルティはありません。"),
    ).toBeInTheDocument();
  });
});
