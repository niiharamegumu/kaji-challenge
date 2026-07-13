package transport

import (
	"encoding/json"
	"fmt"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestTaskLifecycleAndTaskOverview(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"皿洗い","type":"daily","penaltyPoints":2}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	toggleReq := `{"targetDate":"` + time.Now().In(loc).Format("2006-01-02") + `"}`
	toggleRes := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", toggleReq, token)
	if toggleRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", toggleRes.Code, toggleRes.Body.String())
	}

	taskOverviewRes := doRequest(t, r, http.MethodGet, "/v1/tasks/overview", "", token)
	if taskOverviewRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", taskOverviewRes.Code, taskOverviewRes.Body.String())
	}

	var taskOverview api.TaskOverviewResponse
	if err := json.Unmarshal(taskOverviewRes.Body.Bytes(), &taskOverview); err != nil {
		t.Fatalf("failed to parse task overview: %v", err)
	}
	if len(taskOverview.DailyTasks) == 0 {
		t.Fatalf("expected at least one daily task in task overview response")
	}
}

func TestDeleteTaskSoftDeleteExcludesFromList(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"ソフト削除確認","type":"daily","penaltyPoints":2}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	deleteRes := doRequest(t, r, http.MethodDelete, "/v1/tasks/"+task.Id, "", token)
	if deleteRes.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}

	listRes := doRequest(t, r, http.MethodGet, "/v1/tasks", "", token)
	if listRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", listRes.Code, listRes.Body.String())
	}

	var listed struct {
		Items []api.Task `json:"items"`
	}
	if err := json.Unmarshal(listRes.Body.Bytes(), &listed); err != nil {
		t.Fatalf("failed to parse task list response: %v", err)
	}
	for _, item := range listed.Items {
		if item.Id == task.Id {
			t.Fatalf("deleted task should not appear in list")
		}
	}
}

func TestMonthlySummaryOmitsTaskAfterSameDayDelete(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"月次履歴タスク","type":"daily","penaltyPoints":2}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	today := time.Now().In(loc).Format("2006-01-02")
	targetMonth := time.Now().In(loc).Format("2006-01")

	toggleReq := `{"targetDate":"` + today + `"}`
	toggleRes := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", toggleReq, token)
	if toggleRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", toggleRes.Code, toggleRes.Body.String())
	}

	beforeRes := doRequest(t, r, http.MethodGet, "/v1/penalty-summaries/monthly?month="+targetMonth, "", token)
	if beforeRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", beforeRes.Code, beforeRes.Body.String())
	}
	var before api.MonthlyPenaltySummary
	if err := json.Unmarshal(beforeRes.Body.Bytes(), &before); err != nil {
		t.Fatalf("failed to parse monthly summary(before): %v", err)
	}

	deleteRes := doRequest(t, r, http.MethodDelete, "/v1/tasks/"+task.Id, "", token)
	if deleteRes.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}

	afterRes := doRequest(t, r, http.MethodGet, "/v1/penalty-summaries/monthly?month="+targetMonth, "", token)
	if afterRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", afterRes.Code, afterRes.Body.String())
	}
	var after api.MonthlyPenaltySummary
	if err := json.Unmarshal(afterRes.Body.Bytes(), &after); err != nil {
		t.Fatalf("failed to parse monthly summary(after): %v", err)
	}

	if before.DailyPenaltyTotal != after.DailyPenaltyTotal || before.WeeklyPenaltyTotal != after.WeeklyPenaltyTotal || before.TotalPenalty != after.TotalPenalty {
		t.Fatalf("monthly penalty totals should remain unchanged after task soft delete")
	}

	for _, group := range after.TaskStatusByDate {
		if group.Date.Format("2006-01-02") != today {
			continue
		}
		for _, item := range group.Items {
			if item.TaskId == task.Id {
				t.Fatalf("task should not appear in summary on/after delete date")
			}
		}
	}
}

func TestPenaltyRuleIgnoresLegacyIsActiveField(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	createRes := doRequest(t, r, http.MethodPost, "/v1/penalty-rules", `{"name":"遅刻","threshold":3,"isActive":false}`, token)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", createRes.Code, createRes.Body.String())
	}

	var created map[string]any
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to parse create penalty response: %v", err)
	}
	if _, exists := created["isActive"]; exists {
		t.Fatalf("penalty rule response must not contain isActive")
	}

	var createdRule api.PenaltyRule
	if err := json.Unmarshal(createRes.Body.Bytes(), &createdRule); err != nil {
		t.Fatalf("failed to parse created penalty rule: %v", err)
	}

	patchRes := doRequest(t, r, http.MethodPatch, "/v1/penalty-rules/"+createdRule.Id, `{"name":"遅刻(更新)","isActive":true}`, token)
	if patchRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", patchRes.Code, patchRes.Body.String())
	}
	var patched map[string]any
	if err := json.Unmarshal(patchRes.Body.Bytes(), &patched); err != nil {
		t.Fatalf("failed to parse patch penalty response: %v", err)
	}
	if _, exists := patched["isActive"]; exists {
		t.Fatalf("patched penalty rule response must not contain isActive")
	}
}

func TestDeletePenaltyRuleSoftDeleteExcludesFromDefaultList(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	createRes := doRequest(t, r, http.MethodPost, "/v1/penalty-rules", `{"name":"深夜帰宅","threshold":5}`, token)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", createRes.Code, createRes.Body.String())
	}
	var created api.PenaltyRule
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to parse created penalty rule: %v", err)
	}

	deleteRes := doRequest(t, r, http.MethodDelete, "/v1/penalty-rules/"+created.Id, "", token)
	if deleteRes.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}

	listRes := doRequest(t, r, http.MethodGet, "/v1/penalty-rules", "", token)
	if listRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", listRes.Code, listRes.Body.String())
	}
	var listed struct {
		Items []api.PenaltyRule `json:"items"`
	}
	if err := json.Unmarshal(listRes.Body.Bytes(), &listed); err != nil {
		t.Fatalf("failed to parse list penalty response: %v", err)
	}
	for _, item := range listed.Items {
		if item.Id == created.Id {
			t.Fatalf("deleted penalty rule should not appear in default list")
		}
	}

	listWithDeletedRes := doRequest(t, r, http.MethodGet, "/v1/penalty-rules?includeDeleted=true", "", token)
	if listWithDeletedRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", listWithDeletedRes.Code, listWithDeletedRes.Body.String())
	}
	if err := json.Unmarshal(listWithDeletedRes.Body.Bytes(), &listed); err != nil {
		t.Fatalf("failed to parse list(includeDeleted) response: %v", err)
	}
	foundDeleted := false
	for _, item := range listed.Items {
		if item.Id != created.Id {
			continue
		}
		foundDeleted = true
		if item.DeletedAt == nil {
			t.Fatalf("includeDeleted list must expose deletedAt for soft-deleted rule")
		}
	}
	if !foundDeleted {
		t.Fatalf("expected soft-deleted rule in includeDeleted list")
	}
}

func TestWeeklyTaskIncrementDecrement(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"シンク洗い","type":"weekly","penaltyPoints":2,"requiredCompletionsPerWeek":3}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	today := time.Now().In(loc).Format("2006-01-02")

	increment := func() api.TaskCompletionResponse {
		req := `{"targetDate":"` + today + `","action":"increment"}`
		res := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", req, token)
		if res.Code != http.StatusOK {
			t.Fatalf("increment expected 200, got %d: %s", res.Code, res.Body.String())
		}
		var body api.TaskCompletionResponse
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to parse increment response: %v", err)
		}
		return body
	}

	decrement := func() api.TaskCompletionResponse {
		req := `{"targetDate":"` + today + `","action":"decrement"}`
		res := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", req, token)
		if res.Code != http.StatusOK {
			t.Fatalf("decrement expected 200, got %d: %s", res.Code, res.Body.String())
		}
		var body api.TaskCompletionResponse
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to parse decrement response: %v", err)
		}
		return body
	}

	if c := increment().WeeklyCompletedCount; c != 1 {
		t.Fatalf("expected count 1, got %d", c)
	}
	if c := increment().WeeklyCompletedCount; c != 2 {
		t.Fatalf("expected count 2, got %d", c)
	}
	if c := increment().WeeklyCompletedCount; c != 3 {
		t.Fatalf("expected count 3, got %d", c)
	}
	if c := increment().WeeklyCompletedCount; c != 3 {
		t.Fatalf("expected count to stay 3, got %d", c)
	}

	if c := decrement().WeeklyCompletedCount; c != 2 {
		t.Fatalf("expected count 2, got %d", c)
	}
	if c := decrement().WeeklyCompletedCount; c != 1 {
		t.Fatalf("expected count 1, got %d", c)
	}
	if c := decrement().WeeklyCompletedCount; c != 0 {
		t.Fatalf("expected count 0, got %d", c)
	}
	if c := decrement().WeeklyCompletedCount; c != 0 {
		t.Fatalf("expected count to stay 0, got %d", c)
	}
}

func TestWeeklyTaskWithSingleRequiredAllowsIncrement(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"皿洗い","type":"weekly","penaltyPoints":2,"requiredCompletionsPerWeek":1}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	today := time.Now().In(loc).Format("2006-01-02")

	req := `{"targetDate":"` + today + `","action":"increment"}`
	res := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", req, token)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}
}

func TestWeeklyTaskToggleWithoutActionDefaultsToIncrement(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"風呂掃除","type":"weekly","penaltyPoints":2,"requiredCompletionsPerWeek":3}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	today := time.Now().In(loc).Format("2006-01-02")

	toggleWithoutAction := func() api.TaskCompletionResponse {
		req := `{"targetDate":"` + today + `"}`
		res := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", req, token)
		if res.Code != http.StatusOK {
			t.Fatalf("toggle expected 200, got %d: %s", res.Code, res.Body.String())
		}
		var body api.TaskCompletionResponse
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to parse toggle response: %v", err)
		}
		return body
	}

	if c := toggleWithoutAction().WeeklyCompletedCount; c != 1 {
		t.Fatalf("expected count 1, got %d", c)
	}
	if c := toggleWithoutAction().WeeklyCompletedCount; c != 2 {
		t.Fatalf("expected count 2, got %d", c)
	}
}

func TestWeeklyTaskIncrementIsAtomicUnderConcurrency(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	const maxRequiredCompletionsPerWeek = 7
	const workers = 20
	createTaskReq := fmt.Sprintf(
		`{"title":"洗濯","type":"weekly","penaltyPoints":2,"requiredCompletionsPerWeek":%d}`,
		maxRequiredCompletionsPerWeek,
	)
	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", createTaskReq, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	today := time.Now().In(loc).Format("2006-01-02")
	req := `{"targetDate":"` + today + `","action":"increment"}`

	start := make(chan struct{})
	successCh := make(chan struct{}, workers)
	preconditionCh := make(chan struct{}, workers)
	errCh := make(chan string, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			res := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", req, token)
			switch res.Code {
			case http.StatusOK:
				successCh <- struct{}{}
			case http.StatusPreconditionFailed:
				preconditionCh <- struct{}{}
			default:
				errCh <- "increment request failed"
			}
		}()
	}
	close(start)
	wg.Wait()
	close(errCh)
	for msg := range errCh {
		t.Fatal(msg)
	}
	close(successCh)
	close(preconditionCh)
	successCount := len(successCh)
	preconditionCount := len(preconditionCh)
	if successCount == 0 {
		t.Fatalf("expected at least one successful increment")
	}
	if preconditionCount == 0 {
		t.Fatalf("expected some precondition failures under concurrent stale writes")
	}

	overviewRes := doRequest(t, r, http.MethodGet, "/v1/tasks/overview", "", token)
	if overviewRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", overviewRes.Code, overviewRes.Body.String())
	}
	var overview api.TaskOverviewResponse
	if err := json.Unmarshal(overviewRes.Body.Bytes(), &overview); err != nil {
		t.Fatalf("failed to parse task overview: %v", err)
	}

	for _, item := range overview.WeeklyTasks {
		if item.Task.Id == task.Id {
			expectedCount := successCount
			if expectedCount > maxRequiredCompletionsPerWeek {
				expectedCount = maxRequiredCompletionsPerWeek
			}
			if item.WeekCompletedCount != expectedCount {
				t.Fatalf("expected weekly count %d, got %d", expectedCount, item.WeekCompletedCount)
			}
			return
		}
	}
	t.Fatalf("weekly task not found in overview")
}
