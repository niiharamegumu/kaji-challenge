import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type CreatePenaltyRuleRequest,
  type CreateTaskRequest,
  type HomeResponse,
  type PenaltyRule,
  type Task,
  type TaskType,
  TaskType as TaskTypeConst,
  deletePenaltyRule,
  deleteTask,
  getHome,
  getMe,
  getPenaltySummaryMonthly,
  listPenaltyRules,
  listTasks,
  patchPenaltyRule,
  patchTask,
  postAuthOidcGoogleCallback,
  postPenaltyRule,
  postTask,
  postTaskCompletionToggle,
  postTeamInvite,
  postTeamJoin,
} from "./lib/api/generated/client";

type SessionState = {
  token: string | null;
  userName: string | null;
};

type FormState = {
  title: string;
  notes: string;
  type: TaskType;
  penaltyPoints: string;
  requiredCompletionsPerWeek: string;
};

const todayString = () => new Date().toISOString().slice(0, 10);

const taskTypeLabel = (type: TaskType) =>
  type === TaskTypeConst.daily ? "毎日タスク" : "週間タスク";

const formatError = (error: unknown) => {
  const raw = String(error);
  const status = raw.match(/\b(\d{3})\b/)?.[1];
  if (status != null) {
    return `通信エラー（HTTP ${status}）`;
  }
  return "通信エラー";
};

function App() {
  const [session, setSession] = useState<SessionState>({
    token: null,
    userName: null,
  });
  const [email, setEmail] = useState("owner@example.com");
  const [displayName, setDisplayName] = useState("オーナー");
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rules, setRules] = useState<PenaltyRule[]>([]);
  const [inviteCode, setInviteCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [ruleName, setRuleName] = useState("買い出し担当");
  const [ruleThreshold, setRuleThreshold] = useState("10");
  const [status, setStatus] = useState<string>("準備中...");
  const [monthlyTotal, setMonthlyTotal] = useState<number>(0);
  const [tab, setTab] = useState<"home" | "admin">("home");
  const [taskForm, setTaskForm] = useState<FormState>({
    title: "皿洗い",
    notes: "",
    type: TaskTypeConst.daily,
    penaltyPoints: "2",
    requiredCompletionsPerWeek: "3",
  });

  const loggedIn = session.token != null && session.token !== "";

  const refresh = useCallback(async () => {
    if (!loggedIn) {
      return;
    }
    try {
      const [homeRes, tasksRes, rulesRes, summaryRes, meRes] =
        await Promise.all([
          getHome(),
          listTasks(),
          listPenaltyRules(),
          getPenaltySummaryMonthly(),
          getMe(),
        ]);
      setHome(homeRes.data);
      setTasks(tasksRes.data.items);
      setRules(rulesRes.data.items);
      setMonthlyTotal(summaryRes.data.totalPenalty);
      setSession((prev) => ({
        ...prev,
        userName: meRes.data.user.displayName,
      }));
      setStatus("最新状態に同期しました");
    } catch (error) {
      setStatus(`読み込みに失敗しました: ${formatError(error)}`);
    }
  }, [loggedIn]);

  useEffect(() => {
    const token = window.localStorage.getItem("kaji.accessToken");
    if (token != null && token !== "") {
      setSession({ token, userName: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const weeklyProgress = useMemo(() => {
    if (home == null) {
      return "0/0";
    }
    const done = home.weeklyTasks.reduce(
      (acc, item) =>
        acc +
        Math.min(item.weekCompletedCount, item.requiredCompletionsPerWeek),
      0,
    );
    const total = home.weeklyTasks.reduce(
      (acc, item) => acc + item.requiredCompletionsPerWeek,
      0,
    );
    return `${done}/${total}`;
  }, [home]);

  const login = async () => {
    try {
      const res = await postAuthOidcGoogleCallback({ email, displayName });
      const token = res.data.accessToken;
      window.localStorage.setItem("kaji.accessToken", token);
      setSession({ token, userName: res.data.user.displayName });
      setStatus("ログインしました");
    } catch (error) {
      setStatus(`ログインに失敗しました: ${formatError(error)}`);
    }
  };

  const logout = () => {
    window.localStorage.removeItem("kaji.accessToken");
    setSession({ token: null, userName: null });
    setHome(null);
    setTasks([]);
    setRules([]);
    setStatus("ログアウトしました");
  };

  const createTask = async () => {
    const payload: CreateTaskRequest = {
      title: taskForm.title,
      notes: taskForm.notes === "" ? undefined : taskForm.notes,
      type: taskForm.type,
      penaltyPoints: Number(taskForm.penaltyPoints),
      requiredCompletionsPerWeek:
        taskForm.type === TaskTypeConst.weekly
          ? Number(taskForm.requiredCompletionsPerWeek)
          : undefined,
    };
    try {
      await postTask(payload);
      setStatus("タスクを作成しました");
      await refresh();
    } catch (error) {
      setStatus(`タスク作成に失敗しました: ${formatError(error)}`);
    }
  };

  const toggleCompletion = async (taskId: string) => {
    try {
      await postTaskCompletionToggle(taskId, { targetDate: todayString() });
      setStatus("完了状態を更新しました");
      await refresh();
    } catch (error) {
      setStatus(`完了更新に失敗しました: ${formatError(error)}`);
    }
  };

  const deactivateTask = async (taskId: string, isActive: boolean) => {
    try {
      await patchTask(taskId, { isActive: !isActive });
      setStatus("タスク状態を更新しました");
      await refresh();
    } catch (error) {
      setStatus(`タスク更新に失敗しました: ${formatError(error)}`);
    }
  };

  const removeTask = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      setStatus("タスクを削除しました");
      await refresh();
    } catch (error) {
      setStatus(`タスク削除に失敗しました: ${formatError(error)}`);
    }
  };

  const createRule = async () => {
    const payload: CreatePenaltyRuleRequest = {
      name: ruleName,
      threshold: Number(ruleThreshold),
      isActive: true,
    };
    try {
      await postPenaltyRule(payload);
      setStatus("ペナルティルールを作成しました");
      await refresh();
    } catch (error) {
      setStatus(`ルール作成に失敗しました: ${formatError(error)}`);
    }
  };

  const toggleRule = async (rule: PenaltyRule) => {
    try {
      await patchPenaltyRule(rule.id, { isActive: !rule.isActive });
      setStatus("ルール状態を更新しました");
      await refresh();
    } catch (error) {
      setStatus(`ルール更新に失敗しました: ${formatError(error)}`);
    }
  };

  const removeRule = async (ruleId: string) => {
    try {
      await deletePenaltyRule(ruleId);
      setStatus("ルールを削除しました");
      await refresh();
    } catch (error) {
      setStatus(`ルール削除に失敗しました: ${formatError(error)}`);
    }
  };

  const createInvite = async () => {
    try {
      const res = await postTeamInvite({ expiresInHours: 72, maxUses: 2 });
      setInviteCode(res.data.code);
      setStatus("招待コードを発行しました");
    } catch (error) {
      setStatus(`招待コード発行に失敗しました: ${formatError(error)}`);
    }
  };

  const joinTeam = async () => {
    try {
      await postTeamJoin({ code: joinCode });
      setStatus("チーム参加に成功しました");
      await refresh();
    } catch (error) {
      setStatus(`チーム参加に失敗しました: ${formatError(error)}`);
    }
  };

  if (!loggedIn) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-emerald-50 p-6 text-slate-800">
        <div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold">家事チャレ MVP</h1>
          <p className="mt-2 text-sm text-slate-600">
            Google OIDC相当ログイン（開発向け）
          </p>
          <label className="mt-4 block text-sm" htmlFor="login-email">
            メール
          </label>
          <input
            id="login-email"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label className="mt-3 block text-sm" htmlFor="login-name">
            表示名
          </label>
          <input
            id="login-name"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <button
            type="button"
            className="mt-5 rounded-lg bg-emerald-600 px-4 py-2 text-white"
            onClick={() => void login()}
          >
            ログイン
          </button>
          <p
            className="mt-4 text-sm text-slate-700"
            data-testid="status-message"
          >
            {status}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#ecfccb,_#fff,_#fffbeb)] p-4 text-slate-800 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-2xl border border-lime-300 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">家事チャレ</h1>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-lime-100 px-3 py-1 text-sm">
                {session.userName ?? "ログイン中"}
              </span>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
                onClick={logout}
              >
                ログアウト
              </button>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className={`rounded-lg px-3 py-2 text-sm ${tab === "home" ? "bg-slate-900 text-white" : "bg-slate-100"}`}
              onClick={() => setTab("home")}
            >
              ホーム
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-2 text-sm ${tab === "admin" ? "bg-slate-900 text-white" : "bg-slate-100"}`}
              onClick={() => setTab("admin")}
            >
              管理
            </button>
            <button
              type="button"
              className="ml-auto rounded-lg border border-slate-300 px-3 py-2 text-sm"
              onClick={() => void refresh()}
            >
              再読込
            </button>
          </div>
          <p
            className="mt-3 text-sm text-slate-700"
            data-testid="status-message"
          >
            {status}
          </p>
        </header>

        {tab === "home" && (
          <section className="mt-4 grid gap-4 md:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">今日の毎日タスク</h2>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {home?.dailyTasks.map((item) => (
                  <button
                    key={item.task.id}
                    type="button"
                    className={`rounded-xl border p-3 text-left ${item.completedToday ? "border-emerald-400 bg-emerald-50" : "border-slate-300"}`}
                    onClick={() => void toggleCompletion(item.task.id)}
                  >
                    <div className="font-medium">{item.task.title}</div>
                    <div className="text-sm text-slate-600">
                      未達減点: {item.task.penaltyPoints}
                    </div>
                    <div className="mt-1 text-xs">
                      {item.completedToday ? "完了" : "未完了"}
                    </div>
                  </button>
                ))}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">今週の週間タスク</h2>
              <p className="mt-1 text-sm text-slate-600">
                経過日数: {home?.elapsedDaysInWeek ?? 0}日 / 進捗:{" "}
                {weeklyProgress}
              </p>
              <ul className="mt-3 space-y-2">
                {home?.weeklyTasks.map((item) => (
                  <li
                    key={item.task.id}
                    className="rounded-xl border border-slate-300 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{item.task.title}</div>
                        <div className="text-sm text-slate-600">
                          {item.weekCompletedCount}/
                          {item.requiredCompletionsPerWeek} 回
                        </div>
                      </div>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
                        onClick={() => void toggleCompletion(item.task.id)}
                      >
                        トグル
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm">
                今月の減点合計: <strong>{monthlyTotal}</strong>
              </div>
            </article>
          </section>
        )}

        {tab === "admin" && (
          <section className="mt-4 grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">タスク管理</h2>
              <div className="mt-3 grid gap-2">
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="タスク名"
                  value={taskForm.title}
                  onChange={(event) =>
                    setTaskForm((prev) => ({
                      ...prev,
                      title: event.target.value,
                    }))
                  }
                />
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="メモ"
                  value={taskForm.notes}
                  onChange={(event) =>
                    setTaskForm((prev) => ({
                      ...prev,
                      notes: event.target.value,
                    }))
                  }
                />
                <div className="grid grid-cols-3 gap-2">
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    value={taskForm.type}
                    onChange={(event) =>
                      setTaskForm((prev) => ({
                        ...prev,
                        type: event.target.value as TaskType,
                      }))
                    }
                  >
                    <option value={TaskTypeConst.daily}>毎日</option>
                    <option value={TaskTypeConst.weekly}>週間</option>
                  </select>
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    type="number"
                    min={0}
                    value={taskForm.penaltyPoints}
                    onChange={(event) =>
                      setTaskForm((prev) => ({
                        ...prev,
                        penaltyPoints: event.target.value,
                      }))
                    }
                  />
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    type="number"
                    min={1}
                    disabled={taskForm.type !== TaskTypeConst.weekly}
                    value={taskForm.requiredCompletionsPerWeek}
                    onChange={(event) =>
                      setTaskForm((prev) => ({
                        ...prev,
                        requiredCompletionsPerWeek: event.target.value,
                      }))
                    }
                  />
                </div>
                <button
                  type="button"
                  className="rounded-lg bg-slate-900 px-3 py-2 text-white"
                  onClick={() => void createTask()}
                >
                  タスク追加
                </button>
              </div>
              <ul className="mt-4 space-y-2">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="rounded-xl border border-slate-300 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{task.title}</div>
                        <div className="text-xs text-slate-600">
                          {taskTypeLabel(task.type)} / 減点 {task.penaltyPoints}{" "}
                          / {task.isActive ? "有効" : "無効"}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                          onClick={() =>
                            void deactivateTask(task.id, task.isActive)
                          }
                        >
                          {task.isActive ? "無効化" : "有効化"}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700"
                          onClick={() => void removeTask(task.id)}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">ペナルティ/招待管理</h2>
              <div className="mt-3 grid gap-2">
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  value={ruleName}
                  onChange={(event) => setRuleName(event.target.value)}
                  placeholder="ルール名"
                />
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  type="number"
                  min={1}
                  value={ruleThreshold}
                  onChange={(event) => setRuleThreshold(event.target.value)}
                  placeholder="閾値"
                />
                <button
                  type="button"
                  className="rounded-lg bg-slate-900 px-3 py-2 text-white"
                  onClick={() => void createRule()}
                >
                  ルール追加
                </button>
              </div>
              <ul className="mt-4 space-y-2">
                {rules.map((rule) => (
                  <li
                    key={rule.id}
                    className="rounded-xl border border-slate-300 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{rule.name}</div>
                        <div className="text-xs text-slate-600">
                          発動しきい値 {rule.threshold} /{" "}
                          {rule.isActive ? "有効" : "無効"}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                          onClick={() => void toggleRule(rule)}
                        >
                          {rule.isActive ? "無効化" : "有効化"}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700"
                          onClick={() => void removeRule(rule.id)}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <button
                  type="button"
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-white"
                  onClick={() => void createInvite()}
                >
                  招待コード発行
                </button>
                <p className="mt-2 text-sm">
                  発行コード: {inviteCode || "未発行"}
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value)}
                    placeholder="招待コード入力"
                  />
                  <button
                    type="button"
                    className="rounded-lg border border-slate-400 px-3 py-2"
                    onClick={() => void joinTeam()}
                  >
                    参加
                  </button>
                </div>
              </div>
            </article>
          </section>
        )}
      </div>
    </main>
  );
}

export default App;
