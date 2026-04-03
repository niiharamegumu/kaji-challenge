import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        "未来の予定だけを表示します。日付変更は編集から行えます。",
      ),
    ).toBeInTheDocument();
    expect(latestCalendarProps()?.events).toEqual([]);
    expect(
      screen.getByRole("dialog", { name: "4月2日(木) のリマインダー" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "追加" })).toBeInTheDocument();
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

    const agendaDialogs = screen.getAllByRole("dialog", {
      name: "4月2日(木) のリマインダー",
    });
    const agendaDialog = agendaDialogs[agendaDialogs.length - 1];

    expect(agendaDialog).toBeDefined();

    fireEvent.click(
      within(agendaDialog as HTMLElement).getByRole("button", {
        name: "追加",
      }),
    );
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

  it("shows desktop drag-and-drop description and passes events to FullCalendar on desktop", () => {
    setViewport(1280);

    render(
      <MemoryRouter initialEntries={["/calendar?date=2026-03-27"]}>
        <ReminderCalendarPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "未来の予定だけを表示します。ドラッグで日付を変更できます。",
      ),
    ).toBeInTheDocument();
    expect(Array.isArray(latestCalendarProps()?.events)).toBe(true);
    expect((latestCalendarProps()?.events as unknown[]).length).toBe(1);
    expect(latestCalendarProps()?.eventDrop).toBeTypeOf("function");
  });
});
