import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assistRequestSchema,
  assistAudioRequestSchema,
  assistLimits,
  assistAudio,
  assistIntentSchema,
  assistResultSchema,
  type AssistRequest,
} from "../../src/contracts/assist";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import {
  executeAssistTurn,
  transcribeAssistAudio,
} from "../../src/server/application/assist-operations";
import { createTestDatabase } from "../helpers/d1";
import { encodeWav, wavBase64 } from "../../src/features/assist/lib/audio";
import { validateAssistAudio } from "../../src/server/transport/assist-audio";

const add = { intent: "add_todo", items: [{ name: "牛乳", categoryName: null }] };
const validWav = () => encodeWav([new Float32Array(16000).fill(0.2)], 16000);
describe("assist contract and audio boundary", () => {
  it.each([
    { ...add, teamId: crypto.randomUUID() },
    { ...add, items: [{ name: "x".repeat(101), categoryName: null }] },
    { ...add, items: Array.from({ length: assistLimits.items + 1 }, () => add.items[0]) },
    { ...add, items: [] },
    { ...add, items: [{ ...add.items[0], dueDate: "2026-10-24" }] },
    { intent: "delete_todo", id: crypto.randomUUID() },
    { intent: "delete_todos", names: [], categoryName: null },
    { intent: "complete_todos", names: ["牛乳"], categoryName: null, id: crypto.randomUUID() },
    { intent: "delete_todos", names: Array(51).fill("牛乳"), categoryName: null },
    { intent: "list_todos", categoryName: null, nameQuery: "" },
    { intent: "update_todo", name: "牛乳" },
    { intent: "batch_todos", actions: [add] },
    { intent: "batch_todos", actions: Array(11).fill(add) },
    { intent: "batch_todos", actions: [{ intent: "batch_todos", actions: [add, add] }, add] },
    { intent: "batch_todos", actions: [add, { intent: "unsupported", reason: "operation" }] },
    {
      intent: "batch_todos",
      actions: [
        { ...add, items: Array(50).fill(add.items[0]) },
        { intent: "complete_todos", names: ["塩"], categoryName: null },
      ],
    },
    { ...add, dueDate: "2026-10-24" },
    { ...add, names: ["牛乳", "卵"] },
    { ...add, notes: "ignored?" },
  ])("rejects unsafe or unsupported model fields: %j", (input) => {
    expect(assistIntentSchema.safeParse(input).success).toBe(false);
  });
  it("rejects arbitrary conversation context and forged draft fields", () => {
    const input = { transcript: "牛乳を追加", expectedTeamId: crypto.randomUUID() };
    expect(
      assistAudioRequestSchema.safeParse({
        audioBase64: wavBase64(validWav()),
        expectedTeamId: input.expectedTeamId,
      }).success,
    ).toBe(true);
    expect(
      assistRequestSchema.safeParse({
        audioBase64: wavBase64(validWav()),
        expectedTeamId: input.expectedTeamId,
      }).success,
    ).toBe(false);
    expect(assistRequestSchema.safeParse(input).success).toBe(true);
    expect(assistRequestSchema.safeParse({ ...input, history: [] }).success).toBe(false);
    expect(
      assistRequestSchema.safeParse({
        ...input,
        pendingDraft: {
          items: add.items,
          missing: "category",
          expiresAt: Date.now() + 120000,
          operation: "postTodoItem",
        },
      }).success,
    ).toBe(false);
  });
  it("validates actual WAV format, lengths, duration and signal before inference", () => {
    expect(() => validateAssistAudio(wavBase64(validWav()))).not.toThrow();
    for (const offset of [4, 16, 20, 22, 24, 28, 32, 34, 40]) {
      const bad = validWav();
      bad[offset] ^= 1;
      expect(() => validateAssistAudio(wavBase64(bad))).toThrow();
    }
    expect(() => validateAssistAudio(wavBase64(validWav().subarray(0, 100)))).toThrow();
    expect(() =>
      validateAssistAudio(
        wavBase64(
          encodeWav([new Float32Array(16000 * (assistAudio.maxSeconds + 1)).fill(0.2)], 16000),
        ),
      ),
    ).toThrow();
    expect(() =>
      validateAssistAudio(wavBase64(encodeWav([new Float32Array(16000)], 16000))),
    ).toThrow();
  });
  it("accepts quiet speech after a long pause and rejects a brief click in silence", () => {
    const quiet = encodeWav(
      [
        new Float32Array(16000 * 60),
        new Float32Array(4000).fill(0.01),
        new Float32Array(16000 * 10),
      ],
      16000,
    );
    expect(() => validateAssistAudio(wavBase64(quiet))).not.toThrow();
    const click = encodeWav([new Float32Array(160).fill(0.5), new Float32Array(16000)], 16000);
    expect(() => validateAssistAudio(wavBase64(click))).toThrow();
  });
});

describe("assist with real D1 and fixture AI", () => {
  let connection: Awaited<ReturnType<typeof createTestDatabase>>;
  let userId: string, teamId: string, sessionId: string;
  const ai = { transcribe: vi.fn(), interpret: vi.fn() };
  const budget = { reserve: vi.fn() };
  beforeAll(async () => {
    connection = await createTestDatabase();
  });
  beforeEach(async () => {
    userId = crypto.randomUUID();
    sessionId = crypto.randomUUID();
    await connection.query(
      sql`INSERT INTO auth_user(id,name,email) VALUES (${userId},'Assist',${userId + "@example.com"})`,
    );
    await provisionUser(connection.repository, userId, new Date());
    teamId = (await connection.repository.ListMembershipsByUserID(userId))[0].TeamID;
    await connection.query(
      sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${sessionId},${sessionId},${userId},${new Date(Date.now() + 120000).toISOString()})`,
    );
    ai.transcribe.mockReset().mockResolvedValue("牛乳を追加して");
    ai.interpret.mockReset().mockResolvedValue(add);
    budget.reserve.mockReset().mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await connection?.close();
  });
  const request = (extra: Partial<AssistRequest> = {}, signal = new AbortController().signal) =>
    executeAssistTurn(
      connection.repository.forSession(userId, sessionId),
      ai,
      { transcript: "牛乳を追加して", expectedTeamId: teamId, ...extra },
      { userId, signal, budget },
    );
  const items = () => connection.repository.ListTodoItemsByTeamID(teamId);
  const category = async (name = "買い物") => {
    await executeOperation(
      connection.repository.forSession(userId, sessionId),
      { operation: "postTodoCategory", params: {}, body: { name } },
      { userId, now: new Date(), vapidPublicKey: "" },
    );
  };
  const transcription = (
    extra: Partial<Parameters<typeof transcribeAssistAudio>[2]> = {},
    signal = new AbortController().signal,
  ) =>
    transcribeAssistAudio(
      connection.repository.forSession(userId, sessionId),
      ai,
      { audioBase64: "fixture", expectedTeamId: teamId, ...extra },
      { userId, signal, budget },
    );
  it("only transcribes before explicit submission, with no interpretation or ToDo changes", async () => {
    expect(await transcription()).toEqual({ transcript: "牛乳を追加して" });
    expect(ai.interpret).not.toHaveBeenCalled();
    expect(await items()).toHaveLength(0);
    expect(budget.reserve).toHaveBeenCalledOnce();
  });
  it("preserves a long reviewed transcript and all 50 requested additions", async () => {
    const transcript = "買い物で必要なものです。".repeat(60);
    const requested = Array.from({ length: 50 }, (_, i) => ({
      name: `必要なもの${i}`,
      categoryName: null,
    }));
    ai.interpret.mockResolvedValue({ intent: "add_todo", items: requested });
    const result = await request({ transcript });
    expect(ai.interpret).toHaveBeenCalledWith(transcript, undefined, expect.any(AbortSignal), []);
    expect(result.data).toMatchObject({
      kind: "added",
      transcript,
      items: requested.map(({ name }) => ({ name })),
    });
    expect((await items()).map((item) => item.Name)).toEqual(requested.map((item) => item.name));
  });
  it("rejects transcription with the wrong team before inference", async () => {
    await expect(transcription({ expectedTeamId: crypto.randomUUID() })).rejects.toMatchObject({
      status: 403,
    });
    expect(ai.transcribe).not.toHaveBeenCalled();
    expect(budget.reserve).not.toHaveBeenCalled();
  });
  it("does not return a transcript after the session is revoked", async () => {
    ai.transcribe.mockImplementationOnce(async () => {
      await connection.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
      return "牛乳";
    });
    await expect(transcription()).rejects.toMatchObject({ status: 401 });
    expect(ai.interpret).not.toHaveBeenCalled();
    expect(await items()).toHaveLength(0);
  });
  it("does not return an aborted transcript or infer after a failed quota reservation", async () => {
    const controller = new AbortController();
    ai.transcribe.mockImplementationOnce(async () => {
      controller.abort();
      return "牛乳";
    });
    await expect(transcription({}, controller.signal)).rejects.toBeDefined();
    budget.reserve.mockRejectedValueOnce(new Error("quota unavailable"));
    await expect(transcription()).rejects.toThrow("quota unavailable");
    expect(ai.transcribe).toHaveBeenCalledOnce();
    expect(ai.interpret).not.toHaveBeenCalled();
    expect(await items()).toHaveLength(0);
  });
  it("rejects empty or oversized transcription text without interpretation", async () => {
    for (const transcript of ["  ", "あ".repeat(assistLimits.transcript + 1)]) {
      ai.transcribe.mockResolvedValue(transcript);
      await expect(transcription()).rejects.toMatchObject({ code: "unclear_audio" });
    }
    expect(ai.interpret).not.toHaveBeenCalled();
  });
  it("adds one item, returns the saved DTO and lists real data", async () => {
    const added = await request();
    expect(added.changedTeams).toEqual([teamId]);
    expect(assistResultSchema.parse(added.data)).toMatchObject({
      kind: "added",
      items: [{ name: "牛乳", teamId, categoryId: null }],
      replyText: "未分類に牛乳を追加しました。",
    });
    ai.interpret.mockResolvedValue({ intent: "list_todos", categoryName: null });
    expect((await request()).data).toMatchObject({
      kind: "listed",
      total: 1,
      items: [{ name: "牛乳" }],
    });
  });
  it("adds multiple named items to distinct existing categories with one AI interpretation", async () => {
    await category("買い物");
    await category("家事");
    const requested = [
      { name: "牛乳", categoryName: "買い物" },
      { name: "卵", categoryName: "買い物" },
      { name: "洗濯", categoryName: "家事" },
    ];
    ai.interpret.mockResolvedValue({ intent: "add_todo", items: requested });
    const result = await request();
    expect(result.data).toMatchObject({
      kind: "added",
      items: requested.map(({ name }) => ({ name })),
      replyText: "3件追加しました。牛乳、卵、ほか1件です。",
    });
    expect(result.changedTeams).toEqual([teamId]);
    expect(ai.transcribe).not.toHaveBeenCalled();
    expect(ai.interpret).toHaveBeenCalledOnce();
    expect(budget.reserve).toHaveBeenCalledOnce();
    expect(budget.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      ai.interpret.mock.invocationCallOrder[0],
    );
    const rows = await items();
    const categories = await connection.repository.ListTodoCategories(teamId);
    expect(rows.map((row) => row.CategoryID)).toEqual(
      requested.map((item) => categories.find((value) => value?.name === item.categoryName)?.id),
    );
  });
  it("keeps all names while asking for one missing category and only writes the completed batch", async () => {
    await category("買い物");
    await category("家事");
    ai.interpret.mockResolvedValue({
      intent: "add_todo",
      items: [
        { name: "牛乳", categoryName: "買い物" },
        { name: "洗濯", categoryName: null },
      ],
    });
    const draft = (await request()).data;
    expect(draft).toMatchObject({
      kind: "clarify",
      pendingDraft: {
        items: [
          { name: "牛乳", categoryName: "買い物" },
          { name: "洗濯", categoryName: null },
        ],
        missing: "category",
      },
    });
    expect(await items()).toHaveLength(0);
    if (draft.kind !== "clarify") throw new Error("Expected draft");

    ai.interpret.mockResolvedValue({
      intent: "add_todo",
      items: [
        { name: "牛乳", categoryName: "買い物" },
        { name: "洗濯", categoryName: "家事" },
      ],
    });
    const result = await request({ pendingDraft: draft.pendingDraft });
    expect(result.data.kind).toBe("added");
    expect(await items()).toHaveLength(2);
    expect(ai.interpret.mock.lastCall?.[1]).toEqual(draft.pendingDraft);
  });
  it("does not turn an unknown requested category into unclassified when no categories exist", async () => {
    ai.interpret.mockResolvedValue({
      intent: "add_todo",
      items: [
        { name: "牛乳", categoryName: "買い物" },
        { name: "卵", categoryName: "未分類" },
      ],
    });
    expect((await request()).data).toMatchObject({
      kind: "clarify",
      pendingDraft: {
        items: [
          { name: "牛乳", categoryName: null },
          { name: "卵", categoryName: "未分類" },
        ],
      },
    });
    expect(await items()).toHaveLength(0);
  });
  it("does not call AI or write when the inference budget cannot be reserved", async () => {
    budget.reserve.mockRejectedValue(new Error("quota unavailable"));
    await expect(request()).rejects.toThrow("quota unavailable");
    expect(ai.transcribe).not.toHaveBeenCalled();
    expect(ai.interpret).not.toHaveBeenCalled();
    expect(await items()).toHaveLength(0);
  });
  it("rechecks the session after reserving budget and before any AI inference", async () => {
    budget.reserve.mockImplementation(async () => {
      await connection.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
    });
    await expect(request()).rejects.toMatchObject({ status: 401 });
    expect(ai.transcribe).not.toHaveBeenCalled();
    expect(ai.interpret).not.toHaveBeenCalled();
    expect(await items()).toHaveLength(0);
  });
  it("asks for a real category and uses a short follow-up without a second mutation", async () => {
    await category();
    const result = (await request()).data;
    expect(result.kind).toBe("clarify");
    expect(await items()).toHaveLength(0);
    if (result.kind !== "clarify") throw new Error("Expected draft");

    ai.interpret.mockResolvedValue({ ...add, items: [{ name: "牛乳", categoryName: "買い物" }] });
    expect((await request({ pendingDraft: result.pendingDraft })).data.kind).toBe("added");
    expect(ai.interpret.mock.lastCall?.[1]).toEqual(result.pendingDraft);
    expect(await items()).toHaveLength(1);
  });
  it("does not invent unknown categories, and ignores expired or distant-future drafts", async () => {
    await category();
    ai.interpret.mockResolvedValue({ ...add, items: [{ name: "牛乳", categoryName: "仕事" }] });
    expect((await request()).data.kind).toBe("clarify");
    expect(await items()).toHaveLength(0);
    for (const expiresAt of [Date.now() - 1, Date.now() + 300000]) {
      await request({
        pendingDraft: {
          items: [{ name: "古い項目", categoryName: null }],
          missing: "category",
          expiresAt,
        },
      });
      expect(ai.interpret.mock.lastCall?.[1]).toBeUndefined();
    }
  });
  it.each([
    { intent: "unsupported", reason: "too_many" },
    { intent: "unsupported", reason: "operation" },
    { intent: "cancel_draft" },
    { intent: "clarify" },
  ])("does not write for %j", async (intent) => {
    ai.interpret.mockResolvedValue(intent);
    await request();
    expect(await items()).toHaveLength(0);
  });
  it("returns a bounded list and a short truthful reply", async () => {
    for (let i = 0; i < 22; i++) {
      ai.interpret.mockResolvedValue({
        ...add,
        items: [{ name: String(i).padStart(3, "0") + "長い名前".repeat(20), categoryName: null }],
      });
      await request();
    }
    ai.interpret.mockResolvedValue({ intent: "list_todos", categoryName: null });
    const result = (await request()).data;
    expect(result).toMatchObject({ kind: "listed", total: 22 });
    if (result.kind === "listed") expect(result.items).toHaveLength(20);
    expect(result.replyText.length).toBeLessThanOrEqual(100);
  });
  it("passes current registered categories to inference and accepts an inferred existing category", async () => {
    await category("買い物");
    await category("仕事");
    ai.interpret.mockResolvedValue({
      intent: "add_todo",
      items: [{ name: "納豆", categoryName: "買い物" }],
    });
    const result = (await request({ transcript: "ToDoに納豆を追加して" })).data;
    expect(ai.interpret.mock.lastCall?.[3]).toEqual(["買い物", "仕事"]);
    expect(result).toMatchObject({
      kind: "added",
      items: [{ name: "納豆", categoryId: expect.any(String) }],
    });
    const categories = await connection.repository.ListTodoCategories(teamId);
    expect((await items())[0].CategoryID).toBe(categories.find((c) => c?.name === "買い物")?.id);
  });
  it("completes salt and adds lemon from one interpretation without dropping either command", async () => {
    ai.interpret.mockResolvedValue({
      intent: "add_todo",
      items: [
        { name: "塩", categoryName: null },
        { name: "塩", categoryName: null },
      ],
    });
    await request();
    ai.interpret.mockClear().mockResolvedValue({
      intent: "batch_todos",
      actions: [
        { intent: "complete_todos", names: ["塩"], categoryName: null },
        { intent: "add_todo", items: [{ name: "レモン", categoryName: null }] },
      ],
    });
    const result = await request({ transcript: "塩は購入した、レモンを追加して" });
    expect(result).toMatchObject({
      data: {
        kind: "batch",
        results: [
          { kind: "removed", action: "complete", count: 2 },
          { kind: "added", items: [{ name: "レモン" }] },
        ],
      },
      changedTeams: [teamId],
    });
    expect(ai.interpret).toHaveBeenCalledOnce();
    expect((await items()).map((item) => item.Name)).toEqual(["レモン"]);
  });
  it("preserves every pending command and performs no writes before missing category clarification", async () => {
    await category("買い物");
    ai.interpret.mockResolvedValue({
      intent: "add_todo",
      items: [{ name: "塩", categoryName: "買い物" }],
    });
    await request();
    const actions = [
      { intent: "complete_todos", names: ["塩"], categoryName: null },
      { intent: "add_todo", items: [{ name: "レモン", categoryName: null }] },
    ];
    ai.interpret.mockResolvedValue({ intent: "batch_todos", actions });
    const result = (await request()).data;
    expect(result).toMatchObject({
      kind: "clarify",
      pendingDraft: { actions },
      replyText: expect.stringContaining("まだ操作していません"),
    });
    expect((await items()).map((item) => item.Name)).toEqual(["塩"]);
    if (result.kind !== "clarify") throw new Error("Expected clarification");
    ai.interpret.mockResolvedValue({ intent: "clarify" });
    const repeated = (await request({ transcript: "どこ？", pendingDraft: result.pendingDraft }))
      .data;
    expect(repeated).toMatchObject({ kind: "clarify", pendingDraft: { actions } });
    expect((await items()).map((item) => item.Name)).toEqual(["塩"]);
    ai.interpret.mockResolvedValue({
      intent: "batch_todos",
      actions: [
        actions[0],
        { intent: "add_todo", items: [{ name: "レモン", categoryName: "買い物" }] },
      ],
    });
    const saved = (await request({ transcript: "買い物", pendingDraft: result.pendingDraft })).data;
    expect(ai.interpret.mock.lastCall?.[1]?.actions).toEqual(actions);
    expect(saved).toMatchObject({
      kind: "batch",
      results: [{ count: 1 }, { items: [{ name: "レモン" }] }],
    });
    expect((await items()).map((item) => item.Name)).toEqual(["レモン"]);
  });
  it("executes mixed additions, removals and searches in spoken order", async () => {
    ai.interpret.mockResolvedValue({
      intent: "batch_todos",
      actions: [
        { intent: "add_todo", items: [{ name: "レモン", categoryName: null }] },
        { intent: "list_todos", categoryName: null, nameQuery: "レモン" },
        { intent: "delete_todos", names: ["レモン"], categoryName: null },
        { intent: "list_todos", categoryName: null },
      ],
    });
    expect((await request()).data).toMatchObject({
      kind: "batch",
      results: [
        { kind: "added" },
        { kind: "listed", total: 1 },
        { kind: "removed", count: 1 },
        { kind: "listed", total: 0 },
      ],
    });
    expect(await items()).toEqual([]);
  });
  it("rejects an unknown category in any mixed command before an earlier completion can write", async () => {
    await request();
    ai.interpret.mockResolvedValue({
      intent: "batch_todos",
      actions: [
        { intent: "complete_todos", names: ["牛乳"], categoryName: null },
        { intent: "list_todos", categoryName: "存在しない" },
      ],
    });
    expect((await request()).data.kind).toBe("unsupported");
    expect((await items()).map((item) => item.Name)).toEqual(["牛乳"]);
  });
  it("combines category and normalized name substring searches without changing data", async () => {
    await category("買い物");
    ai.interpret.mockResolvedValue({
      intent: "add_todo",
      items: [
        { name: "低脂肪牛乳", categoryName: "買い物" },
        { name: "牛乳", categoryName: "未分類" },
        { name: "納豆", categoryName: "買い物" },
        { name: "ＭＩＬＫ", categoryName: "買い物" },
      ],
    });
    await request();
    const before = await items();
    for (const [categoryName, nameQuery, names] of [
      [null, "牛乳", ["低脂肪牛乳", "牛乳"]],
      ["買い物", "牛乳", ["低脂肪牛乳"]],
      [null, "milk", ["ＭＩＬＫ"]],
      ["未分類", "牛乳", ["牛乳"]],
      [null, "存在しない", []],
    ] as const) {
      ai.interpret.mockResolvedValue({ intent: "list_todos", categoryName, nameQuery });
      const result = (await request()).data;
      expect(result.kind).toBe("listed");
      if (result.kind === "listed") {
        expect(result.items.map((item) => item.name)).toEqual(names);
        expect(result.total).toBe(names.length);
      }
    }
    expect(await items()).toEqual(before);
  });
  it.each(["complete_todos", "delete_todos"] as const)(
    "%s removes every full-name duplicate, not partial matches",
    async (intent) => {
      ai.interpret.mockResolvedValue({
        intent: "add_todo",
        items: [
          { name: "牛乳", categoryName: null },
          { name: "牛乳", categoryName: null },
          { name: "低脂肪牛乳", categoryName: null },
          { name: "納豆", categoryName: null },
        ],
      });
      await request();
      ai.interpret.mockResolvedValue({ intent, names: ["牛乳"], categoryName: null });
      expect(await request()).toMatchObject({
        data: {
          kind: "removed",
          count: 2,
          action: intent === "complete_todos" ? "complete" : "delete",
        },
        changedTeams: [teamId],
      });
      expect((await items()).map((item) => item.Name)).toEqual(["低脂肪牛乳", "納豆"]);
      expect(await request()).toMatchObject({ data: { count: 0 }, changedTeams: [] });
    },
  );
  it("limits removal to the explicitly requested category and never falls back for an unknown one", async () => {
    await category("買い物");
    ai.interpret.mockResolvedValue({
      intent: "add_todo",
      items: [
        { name: "牛乳", categoryName: "買い物" },
        { name: "牛乳", categoryName: "未分類" },
      ],
    });
    await request();
    ai.interpret.mockResolvedValue({
      intent: "delete_todos",
      names: ["牛乳"],
      categoryName: "不存在",
    });
    expect((await request()).data.kind).toBe("unsupported");
    expect(await items()).toHaveLength(2);
    ai.interpret.mockResolvedValue({
      intent: "complete_todos",
      names: ["牛乳"],
      categoryName: "買い物",
    });
    expect((await request()).data).toMatchObject({ kind: "removed", count: 1 });
    expect(await items()).toMatchObject([{ Name: "牛乳", CategoryID: null }]);
  });
  it.each(["session", "membership"])(
    "does not remove ToDos when %s changes during inference",
    async (boundary) => {
      await request();
      ai.interpret.mockImplementation(async () => {
        if (boundary === "session")
          await connection.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
        else await connection.query(sql`DELETE FROM team_members WHERE user_id=${userId}`);
        return { intent: "delete_todos", names: ["牛乳"], categoryName: null };
      });
      await expect(request()).rejects.toMatchObject({ status: boundary === "session" ? 401 : 403 });
      expect(await items()).toHaveLength(1);
    },
  );
  it("rejects wrong expected team before calling AI", async () => {
    await expect(request({ expectedTeamId: crypto.randomUUID() })).rejects.toMatchObject({
      status: 403,
    });
    expect(ai.transcribe).not.toHaveBeenCalled();
    expect(budget.reserve).not.toHaveBeenCalled();
  });
  it("rechecks expired sessions after inference", async () => {
    ai.interpret.mockImplementation(async () => {
      await connection.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
      return add;
    });
    await expect(request()).rejects.toMatchObject({ status: 401 });
    expect(await items()).toHaveLength(0);
  });
  it("pins the original team across an AI wait", async () => {
    const otherId = crypto.randomUUID();
    await connection.query(
      sql`INSERT INTO auth_user(id,name,email) VALUES (${otherId},'Other',${otherId + "@example.com"})`,
    );
    await provisionUser(connection.repository, otherId, new Date());
    const otherTeam = (await connection.repository.ListMembershipsByUserID(otherId))[0].TeamID;
    ai.interpret.mockImplementation(async () => {
      await connection.query(
        sql`UPDATE team_members SET team_id=${otherTeam} WHERE user_id=${userId}`,
      );
      return add;
    });
    await expect(request()).rejects.toMatchObject({ status: 403 });
    expect(await items()).toHaveLength(0);
    expect(await connection.repository.ListTodoItemsByTeamID(otherTeam)).toHaveLength(0);
  });
  it("does not write after an aborted inference", async () => {
    const controller = new AbortController();
    ai.interpret.mockImplementation(async () => {
      controller.abort();
      return add;
    });
    await expect(request({}, controller.signal)).rejects.toBeDefined();
    expect(await items()).toHaveLength(0);
  });
  it("rejects malformed AI output without saving", async () => {
    ai.interpret.mockResolvedValue({ ...add, teamId });
    await expect(request()).rejects.toMatchObject({ code: "invalid_intent" });
    expect(await items()).toHaveLength(0);
  });
});
