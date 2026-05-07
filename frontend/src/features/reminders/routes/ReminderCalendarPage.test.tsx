import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReminderCalendarPage } from "./ReminderCalendarPage";

const mockUseReminderDefinitionsQuery = vi.fn();
const mockUseReminderCalendarQuery = vi.fn();
const mockUseReminderMutations = vi.fn();
const mockFullCalendar = vi.fn(
  (props: Record<string, unknown>): ReactElement => (
    <div data-testid="full-calendar" data-props={JSON.stringify(props)} />
  ),
);

vi.mock("../hooks/useReminders", () => ({
  useReminderDefinitionsQuery: () => mockUseReminderDefinitionsQuery(),
  useReminderCalendarQuery: (monthKey: string) =>
    mockUseReminderCalendarQuery(monthKey),
  useReminderMutations: (setStatus: (message: string) => void) =>
    mockUseReminderMutations(setStatus),
}));

vi.mock("@fullcalendar/react", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef((props: Record<string, unknown>, _ref) =>
      mockFullCalendar(props),
    ),
  };
});

vi.mock("@fullcalendar/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/interaction", () => ({
  default: {},
}));
vi.mock("@fullcalendar/core/locales/ja", () => ({ default: {} }));

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 767px)" ? width < 768 : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("ReminderCalendarPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T03:00:00+09:00"));
    mockFullCalendar.mockClear();
    mockUseReminderDefinitionsQuery.mockReturnValue({
      data: [
        {
          id: "rem-1",
          teamId: "team-1",
          title: "sample",
          notes: null,
          kind: "recurring",
          scheduleType: "weekly",
          startDate: "2026-04-02",
          endDate: null,
          createdAt: "2026-03-20T00:00:00Z",
          updatedAt: "2026-03-20T00:00:00Z",
        },
      ],
    });
    mockUseReminderCalendarQuery.mockReturnValue({
      data: [
        {
          date: "2026-04-02",
          items: [
            {
              reminderId: "rem-1",
              date: "2026-04-02",
              title: "sample",
              notes: null,
              kind: "recurring",
              scheduleType: "weekly",
            },
          ],
        },
      ],
      isFetching: false,
    });
    mockUseReminderMutations.mockReturnValue({
      createReminder: { mutateAsync: vi.fn() },
      updateReminder: { mutateAsync: vi.fn() },
      removeReminder: { mutateAsync: vi.fn() },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function latestCalendarProps() {
    const calls = mockFullCalendar.mock.calls;
    return calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
  }

  it("shows mobile-specific description and does not pass events to FullCalendar on mobile", () => {
    setViewport(390);

    render(
      <MemoryRouter initialEntries={["/calendar?date=2026-04-02"]}>
        <ReminderCalendarPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "今月と来月以降の予定を表示します。過去月は表示しません。日付変更は編集から行えます。",
      ),
    ).toBeInTheDocument();
    expect(latestCalendarProps()?.events).toEqual([]);
    expect(
      screen.getByRole("dialog", { name: "4月2日(木) のリマインダー" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "追加" })).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("dialog", { name: "4月2日(木) のリマインダー" }),
      ).queryByRole("button", { name: "追加" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the mobile agenda sheet open after creating a reminder", async () => {
    setViewport(390);
    const createReminder = vi.fn().mockResolvedValue(undefined);
    mockUseReminderMutations.mockReturnValue({
      createReminder: { mutateAsync: createReminder },
      updateReminder: { mutateAsync: vi.fn() },
      removeReminder: { mutateAsync: vi.fn() },
    });

    render(
      <MemoryRouter initialEntries={["/calendar?date=2026-04-02"]}>
        <ReminderCalendarPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "追加" }));
    fireEvent.change(screen.getByLabelText("タイトル"), {
      target: { value: "new reminder" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加する" }));

    expect(createReminder).toHaveBeenCalledWith({
      title: "new reminder",
      notes: undefined,
      kind: "one_time",
      startDate: "2026-04-02",
      scheduleType: undefined,
      endDate: undefined,
    });
    expect(
      screen.getAllByRole("dialog", { name: "4月2日(木) のリマインダー" })
        .length,
    ).toBeGreaterThan(0);
  });

  it("opens the create sheet from the footer quick action on desktop", () => {
    setViewport(1280);

    render(
      <MemoryRouter initialEntries={["/calendar?date=2026-04-02"]}>
        <ReminderCalendarPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "追加" }));

    expect(
      screen.getByRole("dialog", { name: "リマインダーを追加" }),
    ).toBeInTheDocument();
  });

  it("shows desktop drag-and-drop description and passes events to FullCalendar on desktop", () => {
    setViewport(1280);

    render(
      <MemoryRouter initialEntries={["/calendar?date=2026-04-02"]}>
        <ReminderCalendarPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "今月と来月以降の予定を表示します。過去月は表示しません。ドラッグで日付を変更できます。",
      ),
    ).toBeInTheDocument();
    expect(Array.isArray(latestCalendarProps()?.events)).toBe(true);
    expect((latestCalendarProps()?.events as unknown[]).length).toBe(1);
    expect(latestCalendarProps()?.eventDrop).toBeTypeOf("function");
  });

  it("normalizes a past-month URL to the current month and hides the previous month button", () => {
    setViewport(1280);

    render(
      <MemoryRouter initialEntries={["/calendar?date=2026-03-27"]}>
        <ReminderCalendarPage />
      </MemoryRouter>,
    );

    expect(mockUseReminderCalendarQuery).toHaveBeenLastCalledWith("2026-04");
    expect(screen.getByText("2026年04月")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前の月" })).toBeDisabled();
    expect(latestCalendarProps()?.initialDate).toBe("2026-04-01");
  });

  it("keeps current-month past reminders visible while rejecting past-date drops", () => {
    setViewport(1280);
    vi.setSystemTime(new Date("2026-04-15T03:00:00+09:00"));
    mockUseReminderCalendarQuery.mockReturnValue({
      data: [
        {
          date: "2026-04-10",
          items: [
            {
              reminderId: "rem-1",
              date: "2026-04-10",
              title: "sample",
              notes: null,
              kind: "recurring",
              scheduleType: "weekly",
            },
          ],
        },
      ],
      isFetching: false,
    });

    render(
      <MemoryRouter initialEntries={["/calendar?date=2026-04-10"]}>
        <ReminderCalendarPage />
      </MemoryRouter>,
    );

    expect((latestCalendarProps()?.events as unknown[]).length).toBe(1);
    const eventAllow = latestCalendarProps()?.eventAllow as
      | ((dropInfo: { startStr: string }) => boolean)
      | undefined;
    expect(eventAllow?.({ startStr: "2026-04-14" })).toBe(false);
    expect(eventAllow?.({ startStr: "2026-04-15" })).toBe(true);
  });
});
