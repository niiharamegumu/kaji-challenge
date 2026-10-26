import { describe, expect, it, vi } from "vitest";
import {
  closeOutstanding,
  notifyOutstanding,
  type DeliveryPort,
} from "../../src/server/application/jobs";
import type {
  ListActivePushSubscriptionsByTeamIDRow,
  Repository,
} from "../../src/server/application/ports";

const now = new Date("2026-10-26T03:00:00.000Z");

function closingRepository(overrides: Partial<Repository> = {}) {
  return {
    ListTeamIDsForClose: vi.fn(async () => ["team-a"]),
    DeleteExpiredOneTimeRemindersByTeam: vi.fn(async () => 0),
    GetLatestCloseRunTargetDate: vi.fn(async () => "2026-10-22"),
    GetEarliestTaskCreatedAtByTeam: vi.fn(async () => ""),
    ClosePeriod: vi.fn(async () => true),
    ...overrides,
  } as unknown as Repository;
}

describe("closing notifications", () => {
  it("notifies once for all committed periods and expired reminders in a team", async () => {
    const repository = closingRepository({
      DeleteExpiredOneTimeRemindersByTeam: vi.fn(async () => 2),
    });
    const notify = vi.fn(async () => {});
    await closeOutstanding(repository, "day", now, notify);
    expect(repository.ClosePeriod).toHaveBeenCalledTimes(3);
    expect(notify.mock.calls).toEqual([["team-a"]]);
  });

  it("does not notify when every period was already closed", async () => {
    const repository = closingRepository({ ClosePeriod: vi.fn(async () => false) });
    const notify = vi.fn(async () => {});
    await closeOutstanding(repository, "day", now, notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies reminder removal even when the team has no task history", async () => {
    const repository = closingRepository({
      DeleteExpiredOneTimeRemindersByTeam: vi.fn(async () => 1),
      GetLatestCloseRunTargetDate: vi.fn(async () => ""),
    });
    const notify = vi.fn(async () => {});
    await closeOutstanding(repository, "day", now, notify);
    expect(repository.ClosePeriod).not.toHaveBeenCalled();
    expect(notify.mock.calls).toEqual([["team-a"]]);
  });

  it("notifies earlier commits after a later failure and continues other teams", async () => {
    const repository = closingRepository({
      ListTeamIDsForClose: vi.fn(async () => ["team-a", "team-b"]),
      ClosePeriod: vi.fn(async (teamId, _scope, date) => {
        if (teamId === "team-a" && date === "2026-10-24") throw new Error("close failed");
        return true;
      }),
    });
    const notify = vi.fn(async () => {});
    await expect(closeOutstanding(repository, "day", now, notify)).rejects.toThrow(
      "Closing failed for 1 teams",
    );
    expect(notify.mock.calls).toEqual([["team-a"], ["team-b"]]);
    expect(repository.ClosePeriod).toHaveBeenCalledWith("team-b", "day", "2026-10-25");
  });

  it("finishes all periods before reporting a notification failure", async () => {
    const repository = closingRepository({
      ListTeamIDsForClose: vi.fn(async () => ["team-a", "team-b"]),
    });
    const notify = vi.fn(async (teamId: string) => {
      if (teamId === "team-a") throw new Error("notify failed");
    });
    await expect(closeOutstanding(repository, "day", now, notify)).rejects.toThrow(
      "Closing failed for 1 teams",
    );
    expect(repository.ClosePeriod).toHaveBeenCalledTimes(6);
    expect(notify.mock.calls).toEqual([["team-a"], ["team-b"]]);
  });
});

function subscription(index: number): ListActivePushSubscriptionsByTeamIDRow {
  return {
    ID: `subscription-${index}`,
    TeamID: "team-a",
    UserID: "user-a",
    Endpoint: `https://push.example.com/${index}`,
    P256dh: "fixture",
    Auth: "fixture",
    UserAgent: "fixture",
    Platform: "fixture",
    IsActive: true,
    LastSeenAt: now.toISOString(),
    CreatedAt: now.toISOString(),
    UpdatedAt: now.toISOString(),
  };
}

function pushRepository(subscriptions: ListActivePushSubscriptionsByTeamIDRow[]) {
  return {
    ListTeamIDsForPush: vi.fn(async () => ["team-a"]),
    ListTasksEffectiveForCloseByTeamAndType: vi.fn(async () => [
      { ID: "task-a", Title: "掃除", RequiredCompletionsPerWeek: 1 },
    ]),
    ListTaskCompletionDailyByTeamAndDate: vi.fn(async () => []),
    ListActivePushSubscriptionsByTeamID: vi.fn(async () => subscriptions),
    DeactivatePushSubscriptionByEndpoint: vi.fn(async () => {}),
  } as unknown as Repository;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("push delivery scheduling", () => {
  it("limits in-flight deliveries to four and advances while one endpoint is slow", async () => {
    const subscriptions = Array.from({ length: 9 }, (_, index) => subscription(index));
    const repository = pushRepository(subscriptions);
    const firstStarted = deferred();
    const fastDeliveriesFinished = deferred();
    const releaseFast = deferred();
    const releaseSlow = deferred();
    let inFlight = 0;
    let maximumInFlight = 0;
    let fastFinished = 0;
    const events: string[] = [];
    const delivery: DeliveryPort = {
      claim: vi.fn(async (sub) => {
        events.push(`claim:${sub.ID}`);
        inFlight++;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        return sub.ID;
      }),
      send: vi.fn(async (sub) => {
        events.push(`send:${sub.ID}`);
        firstStarted.resolve();
        await (sub === subscriptions[0] ? releaseSlow.promise : releaseFast.promise);
        return "sent" as const;
      }),
      finish: vi.fn(async (sub) => {
        events.push(`finish:${sub.ID}`);
        inFlight--;
        if (sub !== subscriptions[0] && ++fastFinished === subscriptions.length - 1)
          fastDeliveriesFinished.resolve();
      }),
    };
    const running = notifyOutstanding(repository, delivery, "daily_2100", now);
    try {
      await firstStarted.promise;
      expect(delivery.send).toHaveBeenCalledTimes(4);
      expect(maximumInFlight).toBe(4);
      releaseFast.resolve();
      await fastDeliveriesFinished.promise;
      expect(delivery.send).toHaveBeenCalledTimes(subscriptions.length);
      expect(events).not.toContain(`finish:${subscriptions[0].ID}`);
      expect(maximumInFlight).toBe(4);
    } finally {
      releaseFast.resolve();
      releaseSlow.resolve();
      await running;
    }
    for (const sub of subscriptions)
      expect(events.filter((event) => event.endsWith(`:${sub.ID}`))).toEqual([
        `claim:${sub.ID}`,
        `send:${sub.ID}`,
        `finish:${sub.ID}`,
      ]);
  });

  it("isolates claim, send and finish failures and still deactivates expired endpoints", async () => {
    const subscriptions = Array.from({ length: 7 }, (_, index) => subscription(index));
    const repository = pushRepository(subscriptions);
    const delivery: DeliveryPort = {
      claim: vi.fn(async (sub) => {
        if (sub === subscriptions[0]) return null;
        if (sub === subscriptions[1]) throw new Error("claim failed");
        return sub.ID;
      }),
      send: vi.fn(async (sub) => {
        if (sub === subscriptions[2]) throw new Error("send failed");
        return sub === subscriptions[3] ? "expired" : "sent";
      }),
      finish: vi.fn(async (sub) => {
        if (sub === subscriptions[4]) throw new Error("finish failed");
      }),
    };
    await expect(notifyOutstanding(repository, delivery, "daily_2100", now)).rejects.toThrow(
      "Push failed for 3 deliveries or teams",
    );
    expect(delivery.claim).toHaveBeenCalledTimes(7);
    expect(delivery.send).toHaveBeenCalledTimes(5);
    expect(delivery.finish).toHaveBeenCalledTimes(4);
    expect(repository.DeactivatePushSubscriptionByEndpoint).toHaveBeenCalledExactlyOnceWith({
      Endpoint: subscriptions[3].Endpoint,
      UpdatedAt: now.toISOString(),
    });
    expect(delivery.finish).toHaveBeenCalledWith(
      subscriptions[6],
      "daily_2100",
      "2026-10-26",
      subscriptions[6].ID,
    );
  });
});
