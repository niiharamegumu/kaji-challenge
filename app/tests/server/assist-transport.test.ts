import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { provisionUser } from "../../src/server/application/provision-user";
import { createTestDatabase } from "../helpers/d1";
import { encodeWav, wavBase64 } from "../../src/features/assist/lib/audio";
import { assistLimits } from "../../src/contracts/assist";
import type { RuntimeBindings } from "../../src/server/transport/runtime.server";
const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  notify: vi.fn(),
  auth: vi.fn(),
  run: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("../../src/server/transport/runtime.server", () => ({
  createRuntime: mocks.runtime,
  notifyChanges: mocks.notify,
}));
import {
  handleAssistTurn,
  handleAssistTranscription,
} from "../../src/server/transport/assist.server";

let connection: Awaited<ReturnType<typeof createTestDatabase>>;
const userId = crypto.randomUUID(),
  sessionId = crypto.randomUUID();
let teamId: string;
const bindings = {
  APP_ORIGIN: "https://app.example.com",
  ASSIST_ENABLED: "true",
  ASSIST_GATEWAY_ID: "kaji-voice",
  MAINTENANCE_MODE: "false",
  AI: { run: mocks.run },
  ASSIST_LIMITER: { limit: mocks.limit },
} as unknown as RuntimeBindings;
beforeAll(async () => {
  connection = await createTestDatabase();
  await connection.query(
    sql`INSERT INTO auth_user(id,name,email) VALUES (${userId},'Transport',${userId + "@example.com"})`,
  );
  await provisionUser(connection.repository, userId, new Date());
  teamId = (await connection.repository.ListMembershipsByUserID(userId))[0].TeamID;
  await connection.query(
    sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${sessionId},${sessionId},${userId},${new Date(Date.now() + 120000).toISOString()})`,
  );
});
beforeEach(async () => {
  await connection.query(
    sql`UPDATE assist_usage SET window_start=0,window_count=0,usage_day='',daily_count=0,total_count=0`,
  );
  vi.clearAllMocks();
  mocks.run.mockReset();
  mocks.runtime.mockReturnValue({
    auth: { api: { getSession: mocks.auth } },
    repository: connection.repository,
    db: connection.db,
  });
  mocks.auth.mockResolvedValue({ user: { id: userId }, session: { id: sessionId } });
  mocks.limit.mockResolvedValue({ success: true });
});
afterAll(async () => {
  await connection?.close();
});
function request(
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Request("https://app.example.com/api/assist/turn", {
    method: options.method ?? "POST",
    headers: {
      origin: bindings.APP_ORIGIN,
      "content-type": "application/json",
      ...options.headers,
    },
    ...(options.method === "GET"
      ? {}
      : {
          body:
            options.body ??
            JSON.stringify({
              expectedTeamId: teamId,
              transcript: "秘密の牛乳を追加して",
            }),
        }),
  });
}
it.each([
  [{ method: "GET" }, 405],
  [{ headers: { origin: "https://evil.example" } }, 403],
  [{ headers: { origin: "" } }, 403],
  [{ headers: { "sec-fetch-site": "cross-site" } }, 403],
  [{ headers: { "content-type": "text/plain" } }, 415],
  [{ body: "{" }, 400],
  [{ body: "x".repeat(1048577), headers: { "content-length": "1" } }, 413],
] as const)("rejects invalid HTTP before AI (case %#)", async (options, status) => {
  expect((await handleAssistTurn(request(options), bindings)).status).toBe(status);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("stays off by default and does not authenticate or invoke AI while disabled", async () => {
  expect((await handleAssistTurn(request(), { ...bindings, ASSIST_ENABLED: "false" })).status).toBe(
    503,
  );
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it("rejects absent sessions and rate limits before inference", async () => {
  mocks.auth.mockResolvedValueOnce(null);
  expect((await handleAssistTurn(request(), bindings)).status).toBe(401);
  mocks.limit.mockResolvedValueOnce({ success: false });
  const response = await handleAssistTurn(request(), bindings);
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(mocks.run).not.toHaveBeenCalled();
});
it("interprets only explicitly submitted text through the gateway, saves to D1, notifies, and logs no content", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.run.mockResolvedValueOnce({
    response: JSON.stringify({
      intent: "batch_todos",
      actions: [
        {
          intent: "add_todo",
          items: [{ name: "秘密の牛乳", categoryName: null }],
        },
      ],
    }),
  });
  const response = await handleAssistTurn(request(), bindings);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    kind: "added",
    items: [{ name: "秘密の牛乳", teamId }],
  });
  expect(mocks.run).toHaveBeenCalledTimes(1);
  for (const call of mocks.run.mock.calls)
    expect(call[2]).toMatchObject({
      gateway: {
        id: "kaji-voice",
        skipCache: true,
        collectLog: false,
        retries: { maxAttempts: 1 },
      },
    });
  expect(mocks.notify).toHaveBeenCalledWith(bindings, [teamId], ["todos"]);
  expect(JSON.stringify(log.mock.calls)).not.toContain("秘密");
  log.mockRestore();
});
it("rejects truncated or malformed completions without a write", async () => {
  const count = (await connection.repository.ListTodoItemsByTeamID(teamId)).length;
  mocks.run.mockResolvedValueOnce({
    response: '{"intent":"add_todo","items":[',
  });
  expect((await handleAssistTurn(request(), bindings)).status).toBe(502);
  expect(await connection.repository.ListTodoItemsByTeamID(teamId)).toHaveLength(count);
});
it("returns every mixed operation through HTTP and notifies once after the atomic write", async () => {
  const now = new Date().toISOString();
  await connection.repository.CreateTodoItemsAtomic(
    ["塩", "塩"].map((Name) => ({
      ID: crypto.randomUUID(),
      TeamID: teamId,
      Name,
      Notes: null,
      CategoryID: null,
      SortKey: 100,
      CreatedAt: now,
      UpdatedAt: now,
    })),
  );
  mocks.run.mockResolvedValueOnce({
    response: {
      intent: "batch_todos",
      actions: [
        { intent: "complete_todos", names: ["塩"], categoryName: null },
        { intent: "add_todo", items: [{ name: "レモン", categoryName: null }] },
      ],
    },
  });
  const response = await handleAssistTurn(
    request({
      body: JSON.stringify({
        expectedTeamId: teamId,
        transcript: "塩は購入した、レモンを追加して",
      }),
    }),
    bindings,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    kind: "batch",
    results: [
      { kind: "removed", action: "complete", count: 2 },
      { kind: "added", items: [{ name: "レモン" }] },
    ],
  });
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(bindings, [teamId], ["todos"]);
  const saved = await connection.repository.ListTodoItemsByTeamID(teamId);
  expect(saved.some((item) => item.Name === "塩")).toBe(false);
  expect(saved.some((item) => item.Name === "レモン")).toBe(true);
});

it("searches and removes matching duplicates through HTTP with one change notification", async () => {
  const now = new Date().toISOString();
  await connection.repository.CreateTodoItemsAtomic(
    ["HTTP牛乳", "HTTP牛乳", "HTTP低脂肪牛乳"].map((Name) => ({
      ID: crypto.randomUUID(),
      TeamID: teamId,
      Name,
      Notes: null,
      CategoryID: null,
      SortKey: 100,
      CreatedAt: now,
      UpdatedAt: now,
    })),
  );
  mocks.run.mockResolvedValueOnce({
    response: {
      intent: "batch_todos",
      actions: [{ intent: "list_todos", categoryName: null, nameQuery: "HTTP" }],
    },
  });
  const listed = await handleAssistTurn(request(), bindings);
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({ kind: "listed", total: 3 });
  expect(mocks.notify).not.toHaveBeenCalled();
  mocks.run.mockResolvedValueOnce({
    response: {
      intent: "batch_todos",
      actions: [{ intent: "complete_todos", categoryName: null, names: ["HTTP牛乳"] }],
    },
  });
  const removed = await handleAssistTurn(request(), bindings);
  expect(removed.status).toBe(200);
  expect(await removed.json()).toMatchObject({ kind: "removed", action: "complete", count: 2 });
  expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(bindings, [teamId], ["todos"]);
  expect(
    (await connection.repository.ListTodoItemsByTeamID(teamId))
      .filter((item) => item.Name.startsWith("HTTP"))
      .map((item) => item.Name),
  ).toEqual(["HTTP低脂肪牛乳"]);
});

it("stops exhausted or missing persistent quota before invoking AI", async () => {
  await connection.query(sql`UPDATE assist_usage SET total_count=500`);
  expect((await handleAssistTurn(request(), bindings)).status).toBe(429);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("never refunds an inference failure and never automatically retries it", async () => {
  mocks.run.mockRejectedValueOnce(new Error("Provider unavailable"));
  expect((await handleAssistTurn(request(), bindings)).status).toBe(503);
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect((await connection.query(sql`SELECT total_count FROM assist_usage`)).rows[0]).toEqual({
    total_count: 1,
  });
});
it("fails closed if quota storage is unavailable", async () => {
  mocks.runtime.mockReturnValueOnce({
    auth: { api: { getSession: mocks.auth } },
    repository: connection.repository,
    db: {
      get: async () => {
        throw new Error("quota database unavailable");
      },
    },
  });
  expect((await handleAssistTurn(request(), bindings)).status).toBe(503);
  expect(mocks.run).not.toHaveBeenCalled();
});

function audioRequest(seconds = 120, extra = {}) {
  return request({
    body: JSON.stringify({
      audioBase64: wavBase64(encodeWav([new Float32Array(16000 * seconds).fill(0.2)], 16000)),
      expectedTeamId: teamId,
      ...extra,
    }),
  });
}
it("transcribes 120-second audio without interpreting, saving or notifying", async () => {
  const count = (await connection.repository.ListTodoItemsByTeamID(teamId)).length;
  mocks.run.mockResolvedValueOnce({ text: "買い物に納豆と卵が必要" });
  const response = await handleAssistTranscription(audioRequest(), bindings);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ transcript: "買い物に納豆と卵が必要" });
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.run.mock.calls[0][0]).toBe("@cf/openai/whisper-large-v3-turbo");
  expect(await connection.repository.ListTodoItemsByTeamID(teamId)).toHaveLength(count);
  expect(mocks.notify).not.toHaveBeenCalled();
});
it("requires reviewed text for execution and accepts no execution fields in transcription", async () => {
  expect((await handleAssistTurn(audioRequest(1), bindings)).status).toBe(400);
  expect(
    (await handleAssistTranscription(audioRequest(1, { transcript: "追加して" }), bindings)).status,
  ).toBe(400);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("bounds actual transcription bytes and duration before inference", async () => {
  expect(
    (
      await handleAssistTranscription(
        request({ body: "x".repeat(6 * 1024 * 1024 + 1), headers: { "content-length": "1" } }),
        bindings,
      )
    ).status,
  ).toBe(413);
  expect((await handleAssistTranscription(audioRequest(121), bindings)).status).toBe(400);
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each(["origin", "session", "quota", "team"] as const)(
  "protects transcription at the %s boundary",
  async (boundary) => {
    let input = audioRequest(1);
    if (boundary === "origin") input = request({ headers: { origin: "https://evil.example" } });
    if (boundary === "session") mocks.auth.mockResolvedValueOnce(null);
    if (boundary === "quota") await connection.query(sql`UPDATE assist_usage SET total_count=500`);
    if (boundary === "team") input = audioRequest(1, { expectedTeamId: crypto.randomUUID() });
    expect((await handleAssistTranscription(input, bindings)).status).toBe(
      boundary === "session" ? 401 : boundary === "quota" ? 429 : 403,
    );
    expect(mocks.run).not.toHaveBeenCalled();
  },
);

function audioUpload(seconds = 1) {
  const wav = encodeWav([new Float32Array(16000 * seconds).fill(0.2)], 16000);
  const form = new FormData();
  form.set("audio", new Blob([wav], { type: "audio/wav" }), "recording.wav");
  form.set("expectedTeamId", teamId);
  return { wav, form };
}
function uploadRequest(form: FormData, headers: Record<string, string> = {}) {
  return new Request("https://app.example.com/api/assist/transcribe", {
    method: "POST",
    headers: { origin: bindings.APP_ORIGIN, ...headers },
    body: form,
  });
}
it("transcribes a 120-second multipart WAV with exact bytes and the existing Gateway", async () => {
  const { wav, form } = audioUpload(120);
  const input = uploadRequest(form);
  expect(input.headers.has("content-length")).toBe(false);
  const count = (await connection.repository.ListTodoItemsByTeamID(teamId)).length;
  mocks.run.mockResolvedValueOnce({ text: "粒マスタードを追加して" });
  const response = await handleAssistTranscription(input, bindings);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ transcript: "粒マスタードを追加して" });
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
    "@cf/openai/whisper-large-v3-turbo",
    expect.objectContaining({ audio: wavBase64(wav), language: "ja" }),
    expect.objectContaining({ gateway: expect.objectContaining({ id: "kaji-voice" }) }),
  );
  expect(await connection.repository.ListTodoItemsByTeamID(teamId)).toHaveLength(count);
  expect(mocks.notify).not.toHaveBeenCalled();
});
it.each([
  "missing",
  "duplicate_audio",
  "duplicate_team",
  "extra",
  "string",
  "mime",
  "team",
  "header",
  "truncated",
  "duration",
  "silent",
])("rejects %s multipart audio before invoking AI", async (reason) => {
  const { form, wav } = audioUpload(reason === "duration" ? 121 : 1);
  if (reason === "missing") form.delete("audio");
  if (reason === "duplicate_audio") form.append("audio", new Blob([wav], { type: "audio/wav" }));
  if (reason === "duplicate_team") form.append("expectedTeamId", teamId);
  if (reason === "extra") form.set("transcript", "追加して");
  if (reason === "string") form.set("audio", "not a file");
  if (reason === "mime") form.set("audio", new Blob([wav], { type: "audio/mpeg" }));
  if (reason === "team") form.set("expectedTeamId", "invalid");
  if (reason === "header") {
    wav[24] ^= 1;
    form.set("audio", new Blob([wav], { type: "audio/wav" }));
  }
  if (reason === "truncated")
    form.set("audio", new Blob([wav.subarray(0, 100)], { type: "audio/wav" }));
  if (reason === "silent")
    form.set(
      "audio",
      new Blob([encodeWav([new Float32Array(16000)], 16000)], { type: "audio/wav" }),
    );
  const response = await handleAssistTranscription(uploadRequest(form), bindings);
  expect(response.status).toBe(reason === "silent" ? 422 : 400);
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each([undefined, "1"])(
  "bounds actual multipart bytes with Content-Length %s before parsing",
  async (length) => {
    const input = new Request("https://app.example.com/api/assist/transcribe", {
      method: "POST",
      headers: {
        origin: bindings.APP_ORIGIN,
        "content-type": "multipart/form-data; boundary=test",
        ...(length ? { "content-length": length } : {}),
      },
      body: new Uint8Array(assistLimits.audioUploadBodyBytes + 1),
    });
    expect((await handleAssistTranscription(input, bindings)).status).toBe(413);
    expect(mocks.run).not.toHaveBeenCalled();
  },
);
it.each(["multipart/form-data", "multipart/form-data; boundary=missing"])(
  "rejects malformed multipart: %s",
  async (contentType) => {
    expect(
      (
        await handleAssistTranscription(
          request({ headers: { "content-type": contentType }, body: "invalid multipart" }),
          bindings,
        )
      ).status,
    ).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  },
);
it.each(["origin", "session", "limiter", "quota", "team"] as const)(
  "protects multipart transcription at the %s boundary",
  async (boundary) => {
    const { form } = audioUpload();
    if (boundary === "session") mocks.auth.mockResolvedValueOnce(null);
    if (boundary === "limiter") mocks.limit.mockResolvedValueOnce({ success: false });
    if (boundary === "quota") await connection.query(sql`UPDATE assist_usage SET total_count=500`);
    if (boundary === "team") form.set("expectedTeamId", crypto.randomUUID());
    const input = uploadRequest(
      form,
      boundary === "origin" ? { origin: "https://evil.example" } : {},
    );
    expect((await handleAssistTranscription(input, bindings)).status).toBe(
      boundary === "session" ? 401 : boundary === "quota" || boundary === "limiter" ? 429 : 403,
    );
    expect(mocks.run).not.toHaveBeenCalled();
    if (["origin", "session", "limiter"].includes(boundary)) expect(input.bodyUsed).toBe(false);
  },
);
it("rejects multipart execution so audio can never bypass text review", async () => {
  expect((await handleAssistTurn(uploadRequest(audioUpload().form), bindings)).status).toBe(415);
  expect(mocks.run).not.toHaveBeenCalled();
});
