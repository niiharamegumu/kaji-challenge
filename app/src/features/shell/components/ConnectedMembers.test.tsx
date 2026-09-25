import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import type { TeamMember } from "../../../contracts/models";
import { ConnectedMembers } from "./ConnectedMembers";

const members: TeamMember[] = ["Megu", "Aki", "Hana", "Yuki"].map((name) => ({
  userId: name,
  displayName: name,
  effectiveName: name,
  joinedAt: "2026-09-25T00:00:00.000Z",
  role: "member",
}));

afterEach(cleanup);

it("shows a single connected member and their name on focus, tap and hover", async () => {
  const user = userEvent.setup();
  render(<ConnectedMembers members={members.slice(0, 1)} userIds={["Megu"]} connected />);

  const icon = screen.getByRole("button", { name: "Megu（接続中）" });
  expect(screen.getAllByRole("button")).toHaveLength(1);
  await user.tab();
  expect(icon).toHaveFocus();
  expect(screen.getByRole("tooltip")).toHaveTextContent("Megu（接続中）");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  await user.click(icon);
  expect(screen.getByRole("tooltip")).toBeVisible();
  await user.click(document.body);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  await user.hover(icon);
  expect(screen.getByRole("tooltip")).toBeVisible();
  await user.unhover(icon);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

it("groups remaining members and opens the full live list with keyboard or tap", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ConnectedMembers
      members={members}
      userIds={members.map((member) => member.userId)}
      connected
    />,
  );
  const more = screen.getByRole("button", { name: "ほか2人：チームメンバー全4人を表示" });
  expect(screen.getAllByRole("button")).toHaveLength(3);
  expect(more).toHaveTextContent("+2");
  await user.tab();
  await user.tab();
  await user.tab();
  await user.keyboard("{Enter}");
  expect(more).toHaveAttribute("aria-expanded", "true");
  expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(4);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  await user.click(more);
  expect(screen.getByRole("list")).toBeVisible();

  rerender(<ConnectedMembers members={members} userIds={["Megu", "Aki", "Hana"]} connected />);
  expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(4);
  expect(screen.queryByText("Yuki（接続中）")).not.toBeInTheDocument();
  expect(screen.getByText("Yuki（未接続）")).toBeVisible();
  await user.click(document.body);
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});

it("keeps all members visible but marks their status unknown while disconnected", async () => {
  const user = userEvent.setup();
  const userIds = members.map((member) => member.userId);
  const { rerender } = render(<ConnectedMembers members={members} userIds={userIds} connected />);
  await user.click(screen.getByRole("button", { name: /ほか2人/ }));

  rerender(<ConnectedMembers members={members} userIds={userIds} connected={false} />);
  expect(screen.getByRole("status")).toHaveTextContent("再接続中…");
  expect(screen.getAllByRole("button")).toHaveLength(3);
  expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Megu（接続確認中）" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Megu（接続中）" })).not.toBeInTheDocument();
  expect(screen.getByText("Yuki（接続確認中）")).toBeVisible();

  rerender(<ConnectedMembers members={members} userIds={["Megu"]} connected />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Megu（接続中）" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Aki（未接続）" })).toBeVisible();
});

it("keeps offline avatars in place and updates their state when members connect or leave", () => {
  const { rerender } = render(
    <ConnectedMembers members={members.slice(0, 2)} userIds={["Megu"]} connected />,
  );
  const peer = screen.getByRole("button", { name: "Aki（未接続）" });
  expect(screen.getAllByRole("button")).toHaveLength(2);

  rerender(<ConnectedMembers members={members.slice(0, 2)} userIds={["Megu", "Aki"]} connected />);
  expect(screen.getByRole("button", { name: "Aki（接続中）" })).toBe(peer);
  rerender(<ConnectedMembers members={members.slice(0, 2)} userIds={["Megu"]} connected />);
  expect(screen.getByRole("button", { name: "Aki（未接続）" })).toBe(peer);

  rerender(<ConnectedMembers members={members.slice(0, 1)} userIds={["Megu"]} connected />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /Aki/ })).not.toBeInTheDocument();
});
