import { expect, it, vi } from "vitest";
import type { AssistDraft } from "../../src/contracts/assist";
import { createAssistAi } from "../../src/server/infrastructure/assist-ai";

const additions = {
  intent: "add_todo",
  items: [
    { name: "牛乳", categoryName: "買い物" },
    { name: "卵", categoryName: "買い物" },
  ],
};
// Synthetic fixture for Gemma's documented OpenAI-compatible completion shape; not a live inference.
const chatCompletion = {
  object: "chat.completion",
  model: "@cf/google/gemma-4-26b-a4b-it",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: JSON.stringify(additions),
        refusal: null,
        annotations: null,
        audio: null,
        function_call: null,
        tool_calls: [],
        reasoning: null,
        reasoning_content: null,
      },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 454, completion_tokens: 38, total_tokens: 492 },
};
function fixture() {
  const run = vi.fn();
  const controller = new AbortController();
  return { run, controller, signal: controller.signal, ai: createAssistAi({ run }, "kaji-voice") };
}

it("sends base64 WAV to Whisper Turbo with Japanese transcription explicitly selected", async () => {
  const { ai, run, signal } = fixture();
  const bytes = [82, 73, 70, 70, 0, 127, 128, 255];
  const audioBase64 = btoa(String.fromCharCode(...bytes));
  run.mockResolvedValue({ text: "買い物に牛乳と卵を追加して", word_count: 5 });
  expect(await ai.transcribe(audioBase64, signal)).toBe("買い物に牛乳と卵を追加して");
  expect(run).toHaveBeenCalledExactlyOnceWith(
    "@cf/openai/whisper-large-v3-turbo",
    { audio: audioBase64, task: "transcribe", language: "ja" },
    {
      signal,
      gateway: {
        id: "kaji-voice",
        skipCache: true,
        collectLog: false,
        retries: { maxAttempts: 1 },
        requestTimeoutMs: 25_000,
      },
    },
  );
});

it.each(["not-base64!", "", "A".repeat(5_120_061)])(
  "rejects malformed or oversized audio before paid inference (case %#)",
  async (audio) => {
    const { ai, run, signal } = fixture();
    await expect(ai.transcribe(audio, signal)).rejects.toMatchObject({ code: "invalid_audio" });
    expect(run).not.toHaveBeenCalled();
  },
);

it.each([{ text: "あ".repeat(2001) }, { text: 1 }, {}])(
  "rejects invalid transcriptions without retry (case %#)",
  async (result) => {
    const { ai, run, signal } = fixture();
    run.mockResolvedValue(result);
    await expect(ai.transcribe("UklGRg==", signal)).rejects.toMatchObject({
      code: "invalid_transcription",
    });
    expect(run).toHaveBeenCalledTimes(1);
  },
);

it.each([additions, JSON.stringify(additions)])(
  "accepts complete multi-item interpretations from JSON object/string envelopes (case %#)",
  async (response) => {
    const { ai, run, signal } = fixture();
    const pendingDraft: AssistDraft = {
      items: [
        { name: "牛乳", categoryName: null },
        { name: "卵", categoryName: null },
      ],
      missing: "category",
      expiresAt: Date.now() + 60_000,
    };
    run.mockResolvedValue({ response, usage: { completion_tokens: 90 } });
    expect(await ai.interpret("どちらも買い物", pendingDraft, signal, [])).toEqual(additions);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      "@cf/google/gemma-4-26b-a4b-it",
      expect.objectContaining({
        max_tokens: 8192,
        stream: false,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
        messages: expect.any(Array),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "assist_intent",
            schema: expect.objectContaining({ oneOf: expect.any(Array) }),
          },
        },
      }),
      expect.objectContaining({
        signal,
        gateway: expect.objectContaining({
          id: "kaji-voice",
          skipCache: true,
          collectLog: false,
          retries: { maxAttempts: 1 },
          requestTimeoutMs: 25_000,
        }),
      }),
    );
    expect(run.mock.calls[0][1].messages.at(-1)).toEqual({
      role: "user",
      content: JSON.stringify({ transcript: "どちらも買い物", pendingDraft, categoryNames: [] }),
    });
  },
);

it("provides separate category-specific and all-category dialogue examples before the actual request", async () => {
  const { ai, run, signal } = fixture();
  run.mockResolvedValue({ response: { intent: "list_todos", categoryName: "買い物" } });
  await ai.interpret("買い物リストを教えて", undefined, signal, []);
  const messages = run.mock.calls[0][1].messages;
  expect(messages[0]).toMatchObject({ role: "system" });
  const examples = messages.slice(1, -1);
  for (const [transcript, categoryName] of [
    ["やることを教えて", null],
    ["買い物リストを教えて", "買い物"],
  ]) {
    const userMessage = {
      role: "user",
      content: JSON.stringify({ transcript, pendingDraft: null }),
    };
    const position = examples.findIndex(
      (message: { role: string; content: string }) =>
        message.role === userMessage.role && message.content === userMessage.content,
    );
    expect(position).toBeGreaterThanOrEqual(0);
    expect(examples[position + 1]).toEqual({
      role: "assistant",
      content: JSON.stringify({ intent: "list_todos", categoryName }),
    });
  }
  expect(messages.at(-1)).toEqual({
    role: "user",
    content: JSON.stringify({
      transcript: "買い物リストを教えて",
      pendingDraft: null,
      categoryNames: [],
    }),
  });
});

it("accepts Gemma's documented OpenAI completion shape without another inference", async () => {
  const { ai, run, signal } = fixture();
  run.mockResolvedValue(chatCompletion);
  expect(await ai.interpret("買い物に牛乳と卵を追加して", undefined, signal, [])).toEqual(
    additions,
  );
  expect(run).toHaveBeenCalledTimes(1);
});

it("provides registered category names and routes explicit ToDo commands, inference, search and removal", async () => {
  const { ai, run, signal } = fixture();
  run.mockResolvedValue({
    response: { intent: "complete_todos", names: ["牛乳"], categoryName: null },
  });
  expect(await ai.interpret("ToDoの牛乳を完了して", undefined, signal, ["買い物", "仕事"])).toEqual(
    {
      intent: "complete_todos",
      names: ["牛乳"],
      categoryName: null,
    },
  );
  const messages = run.mock.calls[0][1].messages;
  expect(JSON.parse(messages.at(-1).content)).toEqual({
    transcript: "ToDoの牛乳を完了して",
    pendingDraft: null,
    categoryNames: ["買い物", "仕事"],
  });
  expect(run).toHaveBeenCalledOnce();
});

it.each([
  { choices: [] },
  { choices: [chatCompletion.choices[0], chatCompletion.choices[0]] },
  { choices: [{ ...chatCompletion.choices[0], finish_reason: "length" }] },
  { choices: [{ ...chatCompletion.choices[0], finish_reason: "tool_calls" }] },
  { choices: [{ message: chatCompletion.choices[0].message }] },
  { ...chatCompletion, usage: { completion_tokens: 8192 } },
  { ...chatCompletion, response: additions },
  ...[
    { content: null },
    { content: '{"intent":"add_todo","items":[' },
    { refusal: "This request cannot be completed" },
    { tool_calls: [{ function: { name: "delete_todos", arguments: "{}" } }] },
    { function_call: { name: "delete_todos", arguments: "{}" } },
  ].map((message) => ({
    choices: [
      {
        ...chatCompletion.choices[0],
        message: { ...chatCompletion.choices[0].message, ...message },
      },
    ],
  })),
  { response: additions, refusal: "This request cannot be completed" },
  { response: additions, tool_calls: [{ name: "delete_todos", arguments: {} }] },
])(
  "rejects refusal, tool calls, ambiguous envelopes and incomplete choices (case %#)",
  async (result) => {
    const { ai, run, signal } = fixture();
    run.mockResolvedValue(result);
    await expect(
      ai.interpret("買い物に牛乳と卵を追加して", undefined, signal, []),
    ).rejects.toMatchObject({
      code: "invalid_completion",
    });
    expect(run).toHaveBeenCalledTimes(1);
  },
);

it.each([
  { response: '{"intent":"add_todo","items":[' },
  { response: "```json\n" + JSON.stringify(additions) + "\n```" },
  { response: { ...additions, execute: "delete_todos" } },
  { response: { intent: "add_todo", items: [] } },
  { response: { intent: "add_todo", items: Array.from({ length: 51 }, () => additions.items[0]) } },
  { response: { intent: "add_todo", items: [additions.items[0], { name: "卵" }] } },
  { response: additions, finish_reason: "length" },
  { response: additions, usage: { completion_tokens: 8192 } },
  { response: JSON.stringify(additions) + " ".repeat(65_536) },
  { response: null },
  {},
])(
  "rejects invalid, oversized or possibly truncated output as a whole (case %#)",
  async (result) => {
    const { ai, run, signal } = fixture();
    run.mockResolvedValue(result);
    await expect(ai.interpret("牛乳と卵を追加して", undefined, signal, [])).rejects.toMatchObject({
      code: "invalid_completion",
    });
    expect(run).toHaveBeenCalledTimes(1);
  },
);

it("bounds the serialized prompt and schema before invoking Gemma, including JSON escapes", async () => {
  const { ai, run, signal } = fixture();
  const pendingDraft: AssistDraft = {
    items: Array.from({ length: 50 }, () => ({
      name: "\u0000".repeat(100),
      categoryName: "\u0000".repeat(50),
    })),
    missing: "category",
    expiresAt: Date.now() + 60_000,
  };
  await expect(ai.interpret("\u0000".repeat(2000), pendingDraft, signal, [])).rejects.toMatchObject(
    {
      status: 413,
      code: "assist_input_too_long",
    },
  );
  expect(run).not.toHaveBeenCalled();
});

it.each(["transcribe", "interpret"] as const)(
  "does not retry or expose provider errors from %s",
  async (method) => {
    const { ai, run, signal } = fixture();
    run.mockRejectedValue(new Error("secret transcript and provider credential"));
    const operation =
      method === "transcribe"
        ? ai.transcribe("UklGRg==", signal)
        : ai.interpret("牛乳と卵を追加して", undefined, signal, []);
    await expect(operation).rejects.toMatchObject({ status: 503, code: "ai_unavailable" });
    await expect(operation).rejects.not.toThrow("secret");
    expect(run).toHaveBeenCalledTimes(1);
  },
);

it("never starts inference for an aborted request", async () => {
  const { ai, run, signal, controller } = fixture();
  controller.abort();
  await expect(ai.transcribe("UklGRg==", signal)).rejects.toMatchObject({ name: "AbortError" });
  await expect(ai.interpret("一覧を教えて", undefined, signal, [])).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(run).not.toHaveBeenCalled();
});

it("discards a completed inference after cancellation without trying again", async () => {
  const { ai, run, signal, controller } = fixture();
  run.mockImplementation(async () => {
    controller.abort();
    return { response: additions };
  });
  await expect(ai.interpret("牛乳と卵を追加して", undefined, signal, [])).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(run).toHaveBeenCalledTimes(1);
});
