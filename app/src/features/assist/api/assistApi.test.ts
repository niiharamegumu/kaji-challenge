import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assistAudio } from "../../../contracts/assist";
import { sendAssistTurn, transcribeAssistAudio } from "./assistApi";

const teamSignal = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/serverClient", () => ({ teamRequestSignal: teamSignal }));
const fetchMock = vi.fn();
const teamId = "11111111-1111-4111-8111-111111111111";
const input = {
  audio: new Blob([new Uint8Array(3244)], { type: "audio/wav" }),
  expectedTeamId: teamId,
};
beforeEach(() => {
  teamSignal.mockReturnValue(new AbortController().signal);
  fetchMock.mockReset().mockResolvedValue(Response.json({ transcript: "納豆を追加して" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("uploads a WAV Blob as multipart with browser-generated boundaries and same-origin credentials", async () => {
  await expect(transcribeAssistAudio(input, new AbortController().signal)).resolves.toEqual({
    transcript: "納豆を追加して",
  });
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/assist/transcribe");
  expect(options).toMatchObject({ method: "POST", credentials: "same-origin" });
  expect(options.headers).toBeUndefined();
  expect(options.body).toBeInstanceOf(FormData);
  const form: FormData = options.body;
  expect([...form.keys()]).toEqual(["audio", "expectedTeamId"]);
  expect(form.get("expectedTeamId")).toBe(teamId);
  expect(form.get("audio")).toMatchObject({ name: "recording.wav", type: "audio/wav", size: 3244 });
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("keeps text execution as JSON", async () => {
  fetchMock.mockResolvedValue(
    Response.json({
      kind: "listed",
      transcript: "一覧",
      replyText: "ToDoはありません。",
      items: [],
      total: 0,
    }),
  );
  await sendAssistTurn(
    { transcript: "一覧", expectedTeamId: teamId },
    new AbortController().signal,
  );
  expect(fetchMock.mock.calls[0][0]).toBe("/api/assist/turn");
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript: "一覧", expectedTeamId: teamId }),
  });
});
it("retains notes in a clarification response and the follow-up request", async () => {
  const result = {
    kind: "clarify",
    transcript: "牛乳を追加、低脂肪の1Lを2本",
    replyText: "どのカテゴリーですか？",
    pendingDraft: {
      items: [{ name: "牛乳", categoryName: null, notes: "低脂肪の1Lを2本" }],
      missing: "category",
      expiresAt: Date.now() + 60_000,
    },
    categories: ["買い物"],
  };
  fetchMock.mockImplementation(async () => Response.json(result));
  const response = await sendAssistTurn(
    { transcript: result.transcript, expectedTeamId: teamId },
    new AbortController().signal,
  );
  expect(response).toEqual(result);
  if (response.kind !== "clarify") throw new Error("Expected draft");
  await sendAssistTurn(
    { transcript: "買い物", expectedTeamId: teamId, pendingDraft: response.pendingDraft },
    new AbortController().signal,
  );
  expect(JSON.parse(fetchMock.mock.lastCall![1].body).pendingDraft).toEqual(result.pendingDraft);
});
it.each([
  new Blob(),
  new Blob([new Uint8Array(3244)], { type: "application/octet-stream" }),
  new Blob([new Uint8Array(assistAudio.maxBytes + 1)], { type: "audio/wav" }),
])("rejects invalid uploads before sending", async (audio) => {
  await expect(
    transcribeAssistAudio({ ...input, audio }, new AbortController().signal),
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["user", "team"])("honors %s cancellation before sending", async (kind) => {
  const controller = new AbortController();
  controller.abort();
  if (kind === "team") teamSignal.mockReturnValue(controller.signal);
  await expect(
    transcribeAssistAudio(
      input,
      kind === "user" ? controller.signal : new AbortController().signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("propagates cancellation while an upload is pending and discards a late response", async () => {
  const controller = new AbortController();
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const pending = transcribeAssistAudio(input, controller.signal);
  controller.abort();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  resolve(Response.json({ transcript: "遅い応答" }));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it("validates transcription responses and reports server errors without retrying", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ transcript: 1 }));
  await expect(transcribeAssistAudio(input, new AbortController().signal)).rejects.toThrow();
  fetchMock.mockResolvedValueOnce(
    Response.json({ code: "rate_limited", message: "少し待ってください。" }, { status: 429 }),
  );
  await expect(transcribeAssistAudio(input, new AbortController().signal)).rejects.toMatchObject({
    name: "ApiRequestError",
    status: 429,
    code: "rate_limited",
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
