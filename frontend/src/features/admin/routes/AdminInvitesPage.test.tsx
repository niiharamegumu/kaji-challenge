import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../../../app/providers";
import { appQueryClient } from "../../../shared/query/queryClient";
import { AdminInvitesPage } from "./AdminInvitesPage";

const mockGetMe = vi.fn();
const mockGetTeamCurrentMembers = vi.fn();
const mockGetTeamCurrentInvite = vi.fn();
const mockPostTeamInvite = vi.fn();
const mockPostTeamJoin = vi.fn();
const mockPostTeamLeave = vi.fn();
const mockPatchMeNickname = vi.fn();
const mockPatchTeamCurrent = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<object>("react-router-dom");
  return {
    ...actual,
    useOutletContext: () => ({
      currentUserId: "u1",
      currentTeamName: "Team A",
      displayName: "Owner",
    }),
  };
});

vi.mock("../../../lib/api/generated/client", async () => {
  const actual = await vi.importActual<object>(
    "../../../lib/api/generated/client",
  );
  return {
    ...actual,
    getMe: (...args: unknown[]) => mockGetMe(...args),
    getTeamCurrentMembers: (...args: unknown[]) =>
      mockGetTeamCurrentMembers(...args),
    getTeamCurrentInvite: (...args: unknown[]) =>
      mockGetTeamCurrentInvite(...args),
    postTeamInvite: (...args: unknown[]) => mockPostTeamInvite(...args),
    postTeamJoin: (...args: unknown[]) => mockPostTeamJoin(...args),
    postTeamLeave: (...args: unknown[]) => mockPostTeamLeave(...args),
    patchMeNickname: (...args: unknown[]) => mockPatchMeNickname(...args),
    patchTeamCurrent: (...args: unknown[]) => mockPatchTeamCurrent(...args),
  };
});

describe("AdminInvitesPage", () => {
  beforeEach(() => {
    appQueryClient.clear();
    mockGetMe.mockReset();
    mockGetTeamCurrentMembers.mockReset();
    mockGetTeamCurrentInvite.mockReset();
    mockPostTeamInvite.mockReset();
    mockPostTeamJoin.mockReset();
    mockPostTeamLeave.mockReset();
    mockPatchMeNickname.mockReset();
    mockPatchTeamCurrent.mockReset();

    mockGetTeamCurrentMembers.mockResolvedValue({ data: { items: [] } });
    mockGetTeamCurrentInvite.mockResolvedValue({ data: null });
    mockPostTeamInvite.mockResolvedValue({
      data: {
        code: "NEWCODE",
        teamId: "team-1",
        expiresAt: "2026-02-28T00:00:00Z",
      },
    });
    mockPostTeamJoin.mockResolvedValue({ data: {} });
    mockPostTeamLeave.mockResolvedValue({ data: {} });
    mockPatchMeNickname.mockResolvedValue({ data: {} });
    mockPatchTeamCurrent.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not fetch me on settings page render", async () => {
    render(
      <AppProviders>
        <AdminInvitesPage />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
    });
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("does not re-fetch current invite immediately after creating invite", async () => {
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminInvitesPage />
      </AppProviders>,
    );

    await user.click(
      await screen.findByRole("button", { name: "招待コードを発行" }),
    );

    await waitFor(() => {
      expect(mockPostTeamInvite).toHaveBeenCalledTimes(1);
    });
    expect(mockGetTeamCurrentInvite).toHaveBeenCalledTimes(1);
  });

  it("clears nickname by saving an empty value", async () => {
    mockGetTeamCurrentMembers.mockResolvedValue({
      data: {
        items: [
          {
            userId: "u1",
            displayName: "Owner",
            nickname: "にっく",
            effectiveName: "にっく",
            joinedAt: "2026-02-24T00:00:00Z",
            role: "owner",
          },
        ],
      },
    });
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminInvitesPage />
      </AppProviders>,
    );

    const accountHeading = await screen.findByRole("heading", {
      name: "アカウント設定",
    });
    const accountCard = accountHeading.closest("article");
    if (accountCard == null) {
      throw new Error("account card not found");
    }
    const nicknameInput = within(accountCard).getByLabelText("ニックネーム");
    await waitFor(() => {
      expect(nicknameInput).toHaveValue("にっく");
    });
    await user.clear(nicknameInput);
    await waitFor(() => {
      expect(nicknameInput).toHaveValue("");
    });

    const saveButton = within(accountCard).getByRole("button", {
      name: "保存",
    });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockPatchMeNickname).toHaveBeenCalledWith({ nickname: "" });
    });
  });
});
