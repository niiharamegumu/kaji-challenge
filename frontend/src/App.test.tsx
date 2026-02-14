import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "./App";

vi.mock("./lib/api/generated/client", () => ({
  health: vi.fn().mockResolvedValue({ status: 200, data: { status: "ok" } }),
}));

describe("App", () => {
  it("renders scaffold title", async () => {
    render(<App />);

    expect(screen.getByText("家事チャレ")).toBeInTheDocument();
    expect(await screen.findByTestId("health-status")).toBeInTheDocument();
  });
});
