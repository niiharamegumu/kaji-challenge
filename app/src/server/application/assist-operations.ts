import {
  assistIntentSchema,
  assistResultSchema,
  assistTranscriptionSchema,
  assistLimits,
  type AssistAudioRequest,
  type AssistDraft,
  type AssistRequest,
  type AssistResult,
  type AssistTodoAction,
  type AssistOperationResult,
} from "../../contracts/assist";
import { responseSchemas } from "../../contracts/operations";
import { AppError } from "../domain/errors";
import type { AssistAi, AssistBudget } from "./assist-ports";
import type { Repository, TodoAssistAction } from "./ports";
import { executeOperation } from "./operations";
import { todo } from "./mappers";

const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("ja");
const short = (value: string, max = 28) =>
  value.length > max ? value.slice(0, max - 1) + "…" : value;

/** Transcription cannot interpret a command or perform a write. */
export async function transcribeAssistAudio(
  repository: Repository,
  ai: AssistAi,
  input: AssistAudioRequest,
  context: { userId: string; signal: AbortSignal; budget: AssistBudget },
) {
  const { userId, signal, budget } = context;
  signal.throwIfAborted();
  const member = await repository.ResolveMembershipByUserID(userId);
  if (member.TeamID !== input.expectedTeamId)
    throw new AppError(403, "team_changed", "チームが変わりました。画面を更新してください。");
  const scoped = repository.forMember(member.TeamID, userId);
  await scoped.assertAccess();
  signal.throwIfAborted();
  await budget.reserve();
  await scoped.assertAccess();
  signal.throwIfAborted();
  const transcript = await ai.transcribe(input.audioBase64, signal);
  await scoped.assertAccess();
  signal.throwIfAborted();
  const parsed = assistTranscriptionSchema.safeParse({ transcript });
  if (!parsed.success)
    throw new AppError(422, "unclear_audio", "うまく聞き取れませんでした。話し直してください。");
  return parsed.data;
}

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
  const transcript = input.transcript.trim();
  if (!transcript || transcript.length > assistLimits.transcript)
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
  const categories = (await scoped.ListTodoCategories(member.TeamID)).filter(
    (category) => category !== null,
  );
  await check();
  const parsed = assistIntentSchema.safeParse(
    await ai.interpret(
      transcript,
      draft,
      signal,
      categories.map((category) => category.name),
    ),
  );
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
          ? `一度に指定できるToDoは${assistLimits.items}件までです。まだ操作していません。`
          : intent.reason === "operation"
            ? "ToDoの追加・検索・完了・削除ができます。編集などはToDo画面でお願いします。"
            : "ToDoの追加・検索・完了・削除を、名前と一緒に話してください。",
    });

  const clarify = (
    items: AssistDraft["items"],
    missing: "name" | "category",
    actions?: AssistTodoAction[],
  ) =>
    finish({
      kind: "clarify",
      transcript,
      replyText: short(
        (actions ? "まだ操作していません。" : "") +
          (missing === "name"
            ? "何を追加しますか？"
            : `${short(items.find((item) => item.categoryName === null)?.name ?? "ToDo", 20)}はどのカテゴリーに追加しますか？${categories
                .slice(0, 2)
                .map((c) => short(c.name, 18))
                .join(
                  "、",
                )}${categories.length > 2 ? "など" : ""}、または未分類と話してください。`),
        100,
      ),
      pendingDraft: {
        items,
        missing,
        expiresAt: Date.now() + 120_000,
        ...(actions ? { actions } : {}),
      },
      categories: categories
        .slice(0, 19)
        .map((c) => c.name)
        .concat("未分類"),
    });
  if (intent.intent === "clarify") {
    if (draft) return clarify(draft.items, draft.missing, draft.actions);
    return finish({
      kind: "unsupported",
      transcript,
      replyText:
        "たとえば「牛乳を追加して」「買い物の牛乳を探して」「牛乳を買った」と話してください。",
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
  if (intent.intent === "batch_todos") {
    const pendingActions: AssistTodoAction[] = intent.actions.map((action) =>
      action.intent !== "add_todo"
        ? action
        : {
            ...action,
            items: action.items.map((item) => ({
              ...item,
              categoryName: resolveCategory(item.categoryName).unknown ? null : item.categoryName,
            })),
          },
    );
    if (
      pendingActions.some(
        (action) => action.intent !== "add_todo" && resolveCategory(action.categoryName).unknown,
      )
    ) {
      return finish({
        kind: "unsupported",
        transcript,
        replyText:
          "カテゴリーを特定できない操作があるため、まだ何も操作していません。正式なカテゴリー名で話してください。",
      });
    }
    const additions = pendingActions.flatMap((action) =>
      action.intent === "add_todo" ? action.items : [],
    );
    if (additions.some((item) => item.name === null))
      return clarify(additions, "name", pendingActions);
    if (
      intent.actions.some(
        (action) =>
          action.intent === "add_todo" &&
          action.items.some((item) => resolveCategory(item.categoryName).unknown),
      ) ||
      (categories.length > 0 && additions.some((item) => item.categoryName === null))
    )
      return clarify(additions, "category", pendingActions);
    await check();
    let knownItems = pendingActions.some(
      (action) => action.intent === "complete_todos" || action.intent === "delete_todos",
    )
      ? await scoped.ListTodoItemsByTeamID(member.TeamID)
      : [];
    await check();
    const plans: TodoAssistAction[] = pendingActions.map((action) => {
      if (action.intent === "add_todo") {
        const timestamp = new Date().toISOString();
        const items = action.items.map((item, index) => ({
          ID: crypto.randomUUID(),
          TeamID: member.TeamID,
          Name: item.name!,
          Notes: item.notes || null,
          CategoryID: resolveCategory(item.categoryName).category?.id ?? null,
          SortKey: (index + 1) * 100,
          CreatedAt: timestamp,
          UpdatedAt: timestamp,
        }));
        knownItems = [...items, ...knownItems];
        return { kind: "add", items };
      }
      if (action.intent === "list_todos")
        return {
          kind: "list",
          categoryId:
            action.categoryName === null
              ? undefined
              : (resolveCategory(action.categoryName).category?.id ?? null),
        };
      const categoryId =
        action.categoryName === null
          ? undefined
          : (resolveCategory(action.categoryName).category?.id ?? null);
      const names = new Set(action.names.map(normalize));
      const matches = knownItems.filter(
        (item) =>
          (categoryId === undefined || item.CategoryID === categoryId) &&
          names.has(normalize(item.Name)),
      );
      const ids = new Set(matches.map((item) => item.ID));
      knownItems = knownItems.filter((item) => !ids.has(item.ID));
      return { kind: "remove", names: [...new Set(matches.map((item) => item.Name))], categoryId };
    });
    await check();
    const saved = await scoped.ApplyTodoAssistActionsAtomic(member.TeamID, plans);
    await check();
    if (
      saved.length !== plans.length ||
      saved.some(
        (result, index) =>
          result.kind === "add" &&
          (plans[index].kind !== "add" || result.items.length !== plans[index].items.length),
      )
    ) {
      throw new AppError(
        409,
        "todo_changed",
        "カテゴリーが変更されました。まだ操作していません。一覧を確認してください。",
      );
    }
    const results: AssistOperationResult[] = saved.map((result, index) => {
      const action = pendingActions[index];
      if (result.kind === "add")
        return {
          kind: "added",
          transcript,
          items: result.items.map(todo),
          replyText: `${result.items.length}件追加しました。`,
        };
      if (result.kind === "remove") {
        const completed = action.intent === "complete_todos";
        return {
          kind: "removed",
          transcript,
          action: completed ? "complete" : "delete",
          count: result.count,
          replyText:
            result.count === 0
              ? "一致するToDoはありませんでした。"
              : `${result.count}件${completed ? "完了" : "削除"}しました。`,
        };
      }
      if (action.intent !== "list_todos")
        throw new AppError(
          503,
          "invalid_batch_result",
          "結果を確認できません。ToDo一覧を確認してください。",
        );
      const categoryId =
        action.categoryName === null
          ? undefined
          : (resolveCategory(action.categoryName).category?.id ?? null);
      const nameQuery = action.nameQuery ? normalize(action.nameQuery) : null;
      const items = result.items.filter(
        (item) =>
          (categoryId === undefined || item.CategoryID === categoryId) &&
          (nameQuery === null || normalize(item.Name).includes(nameQuery)),
      );
      return {
        kind: "listed",
        transcript,
        items: items.slice(0, 20).map(todo),
        total: items.length,
        replyText: `一致するToDoは${items.length}件です。`,
      };
    });
    const changed = saved.some((result) =>
      result.kind === "add"
        ? result.items.length > 0
        : result.kind === "remove" && result.count > 0,
    );
    return finish(
      {
        kind: "batch",
        transcript,
        results,
        replyText: short(results.map((result) => result.replyText).join(" "), 100),
      },
      changed ? [member.TeamID] : [],
    );
  }
  if (intent.intent !== "add_todo") {
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
    const categoryItems =
      requested === null ? all : all.filter((item) => item.categoryId === (category?.id ?? null));
    if (intent.intent !== "list_todos") {
      const requestedNames = new Set(intent.names.map(normalize));
      // Destructive actions use full names only. Partial matches are search-only.
      const matchingNames = [
        ...new Set(
          categoryItems
            .filter((item) => requestedNames.has(normalize(item.name)))
            .map((item) => item.name),
        ),
      ];
      await check();
      const count = await scoped.DeleteTodoItemsByNames(
        member.TeamID,
        matchingNames,
        requested === null ? undefined : (category?.id ?? null),
      );
      const action = intent.intent === "complete_todos" ? "complete" : "delete";
      return finish(
        {
          kind: "removed",
          transcript,
          action,
          count,
          replyText:
            count === 0
              ? "一致するToDoはありませんでした。"
              : `${count}件${action === "complete" ? "完了" : "削除"}しました。同じ名前のToDoをすべて対象にしました。`,
        },
        count > 0 ? [member.TeamID] : [],
      );
    }
    const nameQuery = intent.nameQuery ? normalize(intent.nameQuery) : null;
    const items =
      nameQuery === null
        ? categoryItems
        : categoryItems.filter((item) => normalize(item.name).includes(nameQuery));
    const prefix = requested ? short(category?.name ?? "未分類", 18) : "ToDo";
    const replyText =
      items.length === 0
        ? nameQuery
          ? "一致するToDoはありませんでした。"
          : `${prefix}は今ありません。`
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
      Notes: item.notes || null,
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
