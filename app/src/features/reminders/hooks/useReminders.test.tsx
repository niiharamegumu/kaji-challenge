import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useReminderPageQueries } from "./useReminders";

const api = vi.hoisted(() => ({ definitions: vi.fn(), occurrences: vi.fn() }));
vi.mock("../../../lib/api/operations", async (original) => ({
  ...(await original<object>()),
  listReminderDefinitions: api.definitions,
  listReminders: api.occurrences,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function Probe({ month }: { month: string }) {
  const { definitionsQuery, calendarQuery } = useReminderPageQueries(month);
  return (
    <div>
      {definitionsQuery.data.length}:{calendarQuery.data?.[0]?.date ?? "loading"}:
      {String(calendarQuery.isPlaceholderData)}
    </div>
  );
}

it("starts occurrences before a suspended definitions request resolves", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  let finish!: (value: unknown) => void;
  api.definitions.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  api.occurrences.mockResolvedValue({ data: { days: [{ date: "2026-04-02", items: [] }] } });
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback="waiting">
        <Probe month="2026-04" />
      </Suspense>
    </QueryClientProvider>,
  );
  expect(api.definitions).toHaveBeenCalledTimes(1);
  expect(api.occurrences).toHaveBeenCalledTimes(1);
  await act(async () => finish({ data: { items: [] } }));
  expect(await screen.findByText("0:2026-04-02:false")).toBeInTheDocument();
  client.clear();
});

it("keeps the previous month visible while fetching another month", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  api.definitions.mockResolvedValue({ data: { items: [] } });
  let finish!: (value: unknown) => void;
  api.occurrences
    .mockResolvedValueOnce({ data: { days: [{ date: "2026-04-02", items: [] }] } })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
  const view = (month: string) => (
    <QueryClientProvider client={client}>
      <Suspense fallback="waiting">
        <Probe month={month} />
      </Suspense>
    </QueryClientProvider>
  );
  const rendered = render(view("2026-04"));
  expect(await screen.findByText("0:2026-04-02:false")).toBeInTheDocument();
  rendered.rerender(view("2026-05"));
  await waitFor(() => expect(api.occurrences).toHaveBeenCalledTimes(2));
  expect(screen.getByText("0:2026-04-02:true")).toBeInTheDocument();
  await act(async () => finish({ data: { days: [{ date: "2026-05-03", items: [] }] } }));
  expect(await screen.findByText("0:2026-05-03:false")).toBeInTheDocument();
  client.clear();
});
