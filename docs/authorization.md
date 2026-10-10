# 認可境界と検証対応表

## 入口

通常の全41 operationは `operations.functions.ts` の共通入口を通る。Zod入力検証、Origin検証、Better Auth認証の後、検証済みuserId/sessionIdだけで `forSession` を作る。ApplicationがDBから現在の所属を解決し、`forMember` で固定する。userId/teamIdをHTTPヘッダー、params、bodyから認可情報として採用しない。

業務SQLは現在所属・認証と対象行のteamIdを同じ文で照合する。通常セッションは本人・セッションID・DB上の有効期限を確認する。MCPは独立した連携の所有者・grant・scope・期限・失効を確認し、Cookieセッションとは結び付けない。検証済みprincipalのaccess token期限もRepositoryへ渡し、連携期限とともにSQLの実行時時計で確認する。1ユーザー1所属、owner/member以外のrole禁止は既存DB制約に従う。

Applicationは応答前にも認証と期待する所属を再確認し、所属変更で空になった一覧や更新0件を成功として返さない。参加・脱退の成功後は新しい所属を確認する。保存後の失効や応答エラーは既にcommitした変更を取り消すものではなく、書き込みを自動再送しない。

| 入口 | 本人・所属の決定と認可 | 検証 |
| --- | --- | --- |
| 通常Server Function | Cookieセッション→DBの本人所属→用途別SQL。招待作成だけowner限定、通常業務はmemberも可能 | `operations-functions.test.ts`：無認証/別Origin、SQL前のセッション失効・期限切れ・別本人、15種類の他チームID、ヘッダー/params/bodyの偽装 |
| 公開MCP→Service Binding | providerでtoken検証→principal/連携/必要scope/現在所属→同じRepository。公開ツールはlist/add/complete ToDoだけ | `mcp-operations.test.ts`、`mcp-worker.test.ts`、`mcp-workers.test.ts`：他チームID、scope、失効、所属移動、実OAuth/RPC/D1 |
| Realtime | Cookieセッションと所属をSQLで再確認。サーバーが接続先と内部identityヘッダーを設定。配信時にもsession/所属を照合 | `realtime-route.test.ts`、`team-realtime.test.ts`、既存Realtime E2E |
| Cron | Cloudflare scheduled入口、maintenance/JOBS_ENABLED。ユーザーのHTTP操作へ公開しない | `scheduled.test.ts`、`push.test.ts`、`database.test.ts` |
| 初回所属 | Better Authの検証済みGoogle本人を使うsession作成hook。未所属確認と初期チーム作成をbatchで実施 | `auth-access.test.ts`、`database.test.ts`、`d1-atomic.test.ts` |

## 全operationとRepository SQL

下表のチーム操作は `teamAccess`（呼出者の現在所属・認証＋対象チーム一致）を使う。IDだけの参照も対象行のteamIdへ結び付ける。完了テーブルは親tasksのteamIdへ結び付ける。本人操作は `identityAccess` も使う。

`team-access.test.ts` は対象データを両チームに用意し、Repositoryを作成した後に①他チーム対象、②所属移動、③所属削除、④セッション削除、⑤期限切れを与える。read/listは保護データを返さず、create/update/deleteは両チームの全業務テーブルとプロフィールが変わらないことを確認する。正常な現在チームの読取も対で確認する。

| operation | RepositoryのSQL | 追加・既存テスト |
| --- | --- | --- |
| getMe、patchMeNickname、patchMeColor | ListMembershipsByUserID、GetUserByID、UpdateUserNickname、UpdateUserColorHex。本人口座のみ。メンバー表示は別のチーム一覧を使う | team-access：同チームの別本人も拒否。database：プロフィール正常系 |
| getTeamCurrentMembers、patchTeamCurrent | ListTeamMembersByTeamID、UpdateTeamName | team-accessのread/update、database |
| getTeamCurrentInvite、postTeamInvite | GetLatestInviteCodeByTeamID、ReplaceInvite。DELETE/INSERT双方で本人・team・ownerを確認 | team-access：他チーム、SQL前のowner喪失、失効時の旧招待保持 |
| postTeamJoin、postTeamLeave | GetInviteCode、GetUserByID、MoveMember、ListMembershipsByUserID。本人・移動元所属・招待先/期限をbatchで確認 | team-access：不正/期限切れ/置換済み招待、別本人、空の他チーム、失敗時の副作用なし、正常参加/脱退、owner引継ぎ、rollback。d1-atomic：並行移動 |
| listTasks、postTask、patchTask、deleteTask、postTasksReorder | ListTasksByTeamID、CreateTask、GetTaskByID、UpdateTask、DeleteTask、Reorder。担当者も対象チーム所属に限定 | team-accessのread/list/create/update/delete/reorder、operations-functionsの他チームID、database/d1-atomic/weekly-progressの正常系・競合 |
| postTaskCompletion | GetTaskByID、SetCompletion。対象task/team/type/有効期間と本人を照合。変更・再集計・返却件数に同じ条件を使用 | team-access：他チームと他人名義、返却件数の非開示。d1-atomic/weekly-progress：加減算・競合・rollback |
| listReminderDefinitions、listReminders、postReminder、patchReminder、deleteReminder | ListRemindersByTeamID、CreateReminder、GetReminderByID、UpdateReminder、DeleteReminder | team-accessの全CRUD、operations-functionsの他チームID、database/summaryの正常系 |
| listPenaltyRules、postPenaltyRule、patchPenaltyRule、deletePenaltyRule | ListPenaltyRulesByTeamID、ListUndeletedPenaltyRulesByTeamID、CreatePenaltyRule、GetUndeletedPenaltyRuleByID、UpdatePenaltyRule、SoftDeletePenaltyRule | team-accessの全CRUD、operations-functionsの他チームID、database/summary |
| listTodoCategories、postTodoCategory、patchTodoCategory、deleteTodoCategory、postTodoCategoriesReorder | ListTodoCategories、CreateTodoCategory、RenameTodoCategory、DeleteTodoCategory、ReorderTodoCategories。削除は現在チーム内のID存在もSQLで確認し、存在しないIDは404 | team-accessの全操作、operations-functions、todo-category-order/todos/todo-access |
| listTodoItems、postTodoItem、patchTodoItem、deleteTodoItem、postTodoItemsReorder | ListTodoItemsByTeamID、CreateTodoItem、GetTodoItemByID、UpdateTodoItem、DeleteTodoItem、Reorder。カテゴリーも同チームの登録IDに限定 | team-accessの全CRUD/reorder、todo-access/todos/MCP各テスト |
| getTaskOverview、getPenaltySummaryMonthly、getMonthCloseCandidate、postMonthClose | 下記の集計・履歴SQL、RecalculateMonth。保存を伴う締めも対象teamと認証を確認 | team-accessの全集計read/close、summary/database/d1-atomic |
| getPushSubscriptionsMe、postPushSubscription、deletePushSubscription | ListPushSubscriptionsByUserID、UpsertPushSubscription、DeactivatePushSubscriptionByIDAndUser。現在チームと本人を照合 | team-access：別本人/他チーム/旧所属、operations-functions：他人の購読ID、push：endpoint乗っ取り・rollback |

集計・履歴のSQLも個別に否定テストへ登録する：

- GetTaskCompletionWeeklyEntryCount、HasTaskCompletionDaily
- ListTaskCompletionDailyByMonthAndTeam、ListTaskCompletionDailyByTeamAndDate
- ListTaskCompletionWeeklyCountsByTeamAndWeek、ListTaskCompletionWeeklySlotsByMonthAndTeam、ListTaskCompletionWeeklySlotsByTeamAndWeek
- GetEarliestTaskCreatedAtByTeam、ListTasksEffectiveForCloseByTeamAndType、ListTasksForMonthlyStatusByTeam
- FindOldestMonthCloseCandidate、GetMonthlyPenaltySummary、ListTriggeredRuleIDsByMonth、GetLatestCloseRunTargetDate
- ListPenaltyRulesEffectiveAtByTeamID、ListRemindersByTeamID

`summaryStatements` は呼出元の認可SQLを必須とし、暗黙の許可条件を持たない。SetCompletionは完了変更を許可しない場合に集計だけを変更したり件数だけを返したりしない。

## 用途別の境界

- `GetInviteCode` は参加先の有効な招待を提示する操作。現在チーム以外の招待を一覧取得するAPIはなく、招待コード照合とMoveMember内の再検査を通す。所属変更後に通常業務でアクセスできるのは新しいチームだけ。
- `MoveMember` のowner引継ぎは移動前の有効な所属で検査する。直後の空チーム削除は、同じbatchで所属UPDATEが成功した場合に限定する。SQLiteの標準 [changes()](https://www.sqlite.org/lang_corefunc.html#changes) と [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) を使用し、失敗時・最後のメンバーの正常移動を実D1 fixtureで検証する。
- Push再登録の旧レコード整理は、本人の同じendpointの非アクティブ購読だけを対象とする。現在チームでの登録認可と同じbatchで行い、他人の購読・他チームのアクティブ購読は整理しない。旧チームの購読を通常の一覧/ID指定削除で操作することはできない。
- `ListTeamIDsForClose`、`ListTeamIDsForPush`、`ListActivePushSubscriptionsByTeamID`、`DeactivatePushSubscriptionByEndpoint`、`ClosePeriod` はtrusted Cron専用、`ProvisionUser` は認証hook専用、`DeleteTeam` はfixture cleanup用。これらは認証済み/所属付きRepositoryからの呼出を403で拒否する。`DeleteExpiredOneTimeRemindersByTeam` は対象teamの条件を保持する。
- Push配送のclaimは、購読ID・team/user・endpoint/鍵・有効性・現在所属をSQLで照合する。finishはそのclaimを照合する。これらはCron専用の配信台帳で、ユーザーの業務更新APIではない。
- Better Authのuser/account/session/rate limit、MCP connection/consent/grantは本人・認証主体のデータでありteamIdを後付けしない。既存の本人/所有者/セッション/nonce検証を保持する。MCPの管理操作がチーム業務SQLを迂回する経路は作らない。

## 検証の範囲

否定テストは既存Vitest runner、使い捨てD1 fixture、既存Workers/E2Eを使用する。実本番への攻撃、実データ操作、実クライアントによる継続アクセスの検証は行わない。ローカルの成功は本番配備状態や将来追加される入口の安全を絶対保証するものではない。新しいRepositoryメソッド・入口はこの対応表と否定テストへ追加する。

### 自然失効と時計

招待のApplication検査とMCPの認証・応答前再検査は、業務用の要求開始時刻ではなく現在の `Date.now()` を使う。MCP連携を取得するawaitの後にもtoken/connection期限を照合する。SQLはセッション・招待・MCP連携・access tokenを `strftime('%Y-%m-%dT%H:%M:%fZ','now')` と比較する。同意claim消費・grant結合では呼出時刻の条件に加えてDB時計を使い、待機中の自然失効も拒否する。UTC・ミリ秒のISO形式で照合し、期限と同時刻は失効とする。

`mcp-operations.test.ts` / `team-access.test.ts` のfake DateはApplicationだけを動かす。SQL検査ではfake timerを使わず、実D1時計から短い期限を設定し、SQL構築後・batch実行前にその期限を自然に越えるまで待つ。MCPではアプリとDBの時計が同じ実時間範囲にあることも確認する。expiry列は待機中に変更せず、拒否と副作用なしを確認する。`mcp-connections.test.ts` も同意claim・セッション・連携の自然失効を検査する。

検証したのはawait中・batch送信待ち・書込後の応答前の失効であり、本番で長時間実行中のbatchの全statement間に期限を挟む再現ではない。[SQLiteの現在時刻](https://www.sqlite.org/lang_datefunc.html)は同じsqlite3_step内で一定で、batch全体の時計固定を保証する記述ではない。[Workersの時計](https://developers.cloudflare.com/workers/runtime-apis/performance/)にも本番ではI/O後に進む制約がある。したがって認可条件は各SQLが観測した時刻の判定であり、batch完了時刻までの有効性や期限超過による自動rollbackは保証しない。特に複数文の途中で時計が期限を越える場合の部分的な業務変更は未検証であり、厳密な全変更の拒否が必要なら別途設計する。SQLエラーによるbatch全体rollbackは既存テストで検証する。応答前に失効した場合は401を返すが、既に保存済みの変更は残り、自動再送しない。

認証・所属なしのRepositoryはCron/bootstrap/OAuth等のtrusted内部処理用に残す。将来の入口が誤ってこれを業務アクセスへ渡すリスクは型だけでは排除していないため、入口追加時に検証済みidentityを引き継ぐレビューと否定テストを必須とする。
