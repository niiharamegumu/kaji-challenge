import {
  assistIntentSchema,
  assistResultSchema,
  type AssistDraft,
  type AssistRequest,
  type AssistResult,
} from "../../contracts/assist";
import { responseSchemas } from "../../contracts/operations";
import { AppError } from "../domain/errors";
import type { AssistAi, AssistBudget } from "./assist-ports";
import type { Repository } from "./ports";
import { executeOperation } from "./operations";
import { todo } from "./mappers";

const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("ja");
const short = (value: string, max = 28) =>
  value.length > max ? value.slice(0, max - 1) + "…" : value;

export async function executeAssistTurn(
  repository: Repository,
  ai: AssistAi,
  input: AssistRequest,
  context: { userId: string; signal: AbortSignal; budget: AssistBudget },
): Promise<{ data: AssistResult; changedTeams: string[] }> {
  const { userId, signal } = context;
  signal.throwIfAborted();
  const member = await repository.ResolveMembershipByUserID(userId);
  if (member.TeamID !== input.expectedTeamId)
    throw new AppError(403, "team_changed", "チームが変わりました。画面を更新してください。");
  const scoped = repository.forMember(member.TeamID, userId);
  const check = async () => {
    signal.throwIfAborted();
    await scoped.assertAccess();
    signal.throwIfAborted();
  };
  await check();
  await context.budget.reserve();
  await check();
  const transcript = (await ai.transcribe(input.audioBase64, signal)).trim();
  await check();
  if (!transcript || transcript.length > 500)
    throw new AppError(
      422,
      "unclear_audio",
      "うまく聞き取れませんでした。短く話し直してください。",
    );
  const now = Date.now();
  const draft =
    input.pendingDraft &&
    input.pendingDraft.expiresAt > now &&
    input.pendingDraft.expiresAt <= now + 120_000
      ? input.pendingDraft
      : undefined;
  const parsed = assistIntentSchema.safeParse(await ai.interpret(transcript, draft, signal));
  await check();
  if (!parsed.success)
    throw new AppError(
      422,
      "invalid_intent",
      "内容を確認できなかったので操作しませんでした。話し直してください。",
    );
  const intent = parsed.data;
  const finish = async (data: AssistResult, changedTeams: string[] = []) => {
    await check();
    return { data: assistResultSchema.parse(data), changedTeams };
  };
  if (intent.intent === "cancel_draft")
    return finish({ kind: "cancelled", transcript, replyText: "未確定の追加をやめました。" });
  if (intent.intent === "unsupported")
    return finish({
      kind: "unsupported",
      transcript,
      replyText:
        intent.reason === "too_many"
          ? "一度に追加できるのは10件までです。まだ追加していません。"
          : intent.reason === "operation"
            ? "音声ではToDoの追加と確認ができます。その他の操作はToDo画面でお願いします。"
            : "ToDoの追加か確認を、短く話してください。",
    });

  const categories = (await scoped.ListTodoCategories(member.TeamID)).filter(
    (category) => category !== null,
  );
  await check();
  const clarify = (items: AssistDraft["items"], missing: "name" | "category") =>
    finish({
      kind: "clarify",
      transcript,
      replyText: short(
        missing === "name"
          ? "何を追加しますか？"
          : `${short(items.find((item) => item.categoryName === null)?.name ?? "ToDo", 20)}はどのカテゴリーに追加しますか？${categories
              .slice(0, 2)
              .map((c) => short(c.name, 18))
              .join("、")}${categories.length > 2 ? "など" : ""}、または未分類と話してください。`,
        100,
      ),
      pendingDraft: { items, missing, expiresAt: Date.now() + 120_000 },
      categories: categories
        .slice(0, 19)
        .map((c) => c.name)
        .concat("未分類"),
    });
  if (intent.intent === "clarify") {
    if (draft) return clarify(draft.items, draft.missing);
    return finish({
      kind: "unsupported",
      transcript,
      replyText: "たとえば「買い物に牛乳を追加して」と話してください。",
    });
  }
  const resolveCategory = (requested: string | null) => {
    const matches = requested
      ? categories.filter((category) => normalize(category.name) === normalize(requested))
      : [];
    const unclassified =
      requested !== null && normalize(requested) === "未分類" && matches.length === 0;
    return {
      category: matches[0],
      unknown: requested !== null && !unclassified && matches.length !== 1,
    };
  };
  if (intent.intent === "list_todos") {
    const requested = intent.categoryName;
    const { category, unknown } = resolveCategory(requested);
    if (unknown)
      return finish({
        kind: "unsupported",
        transcript,
        replyText: "そのカテゴリーを特定できませんでした。正式なカテゴリー名で話してください。",
      });
    await check();
    const result = await executeOperation(
      scoped,
      { operation: "listTodoItems", params: {} },
      { userId, now: new Date(), vapidPublicKey: "" },
    );
    const all = responseSchemas.listTodoItems.parse(result.data).items;
    const items =
      requested === null ? all : all.filter((item) => item.categoryId === (category?.id ?? null));
    const prefix = requested ? short(category?.name ?? "未分類", 18) : "ToDo";
    const replyText =
      items.length === 0
        ? `${prefix}は今ありません。`
        : `${prefix}は${items.length}件です。${items
            .slice(0, 2)
            .map((item) => short(item.name, 22))
            .join("、")}${items.length > 2 ? `、ほか${items.length - 2}件` : ""}です。`;
    return finish({
      kind: "listed",
      transcript,
      replyText: short(replyText, 100),
      items: items.slice(0, 20),
      total: items.length,
    });
  }
  const pendingItems = intent.items.map((item) => ({
    ...item,
    categoryName: resolveCategory(item.categoryName).unknown ? null : item.categoryName,
  }));
  if (pendingItems.some((item) => item.name === null)) return clarify(pendingItems, "name");
  if (
    intent.items.some((item) => resolveCategory(item.categoryName).unknown) ||
    (pendingItems.some((item) => item.categoryName === null) && categories.length > 0)
  )
    return clarify(pendingItems, "category");
  await check();
  const timestamp = new Date().toISOString();
  const saved = await scoped.CreateTodoItemsAtomic(
    pendingItems.map((item) => ({
      ID: crypto.randomUUID(),
      TeamID: member.TeamID,
      Name: item.name!,
      CategoryID: resolveCategory(item.categoryName).category?.id ?? null,
      Notes: null,
      SortKey: 100,
      CreatedAt: timestamp,
      UpdatedAt: timestamp,
    })),
  );
  if (saved.length !== pendingItems.length)
    throw new AppError(409, "todo_changed", "カテゴリーが変更されました。一覧を確認してください。");
  const items = saved.map(todo);
  const categoryLabel = short(
    resolveCategory(pendingItems[0].categoryName).category?.name ?? "未分類",
    25,
  );
  return finish(
    {
      kind: "added",
      transcript,
      items,
      replyText:
        items.length === 1
          ? `${categoryLabel}に${short(items[0].name, 45)}を追加しました。`
          : `${items.length}件追加しました。${items
              .slice(0, 2)
              .map((item) => short(item.name, 20))
              .join("、")}${items.length > 2 ? `、ほか${items.length - 2}件` : ""}です。`,
    },
    [member.TeamID],
  );
}
