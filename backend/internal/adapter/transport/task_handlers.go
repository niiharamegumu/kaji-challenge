package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/application/model"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (h *Handler) ListTasks(c *gin.Context, params api.ListTasksParams) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	filter, ok := convertTransportModel[*model.TaskType](c, params.Type)
	if !ok {
		return
	}
	items, err := h.services.Task.ListTasks(c.Request.Context(), userID, filter)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostTask(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.CreateTaskRequest](c)
	if !ok {
		return
	}
	appReq, ok := convertTransportModel[model.CreateTaskRequest](c, req)
	if !ok {
		return
	}
	task, err := h.services.Task.CreateTask(c.Request.Context(), userID, appReq)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusCreated, task)
}

func (h *Handler) PatchTask(c *gin.Context, taskID string) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.UpdateTaskRequest](c)
	if !ok {
		return
	}
	appReq, ok := convertTransportModel[model.UpdateTaskRequest](c, req)
	if !ok {
		return
	}
	task, err := h.services.Task.PatchTask(c.Request.Context(), userID, taskID, appReq)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, task)
}

func (h *Handler) DeleteTask(c *gin.Context, taskID string) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	if err := h.services.Task.DeleteTask(c.Request.Context(), userID, taskID); err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.Status(http.StatusNoContent)
}

func (h *Handler) PostTasksReorder(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.ReorderTasksRequest](c)
	if !ok {
		return
	}
	appReq, ok := convertTransportModel[model.ReorderTasksRequest](c, req)
	if !ok {
		return
	}
	items, err := h.services.Task.ReorderTasks(c.Request.Context(), userID, appReq)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostTaskCompletionToggle(c *gin.Context, taskID string) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.ToggleTaskCompletionRequest](c)
	if !ok {
		return
	}
	appAction, ok := convertTransportModel[*model.ToggleTaskCompletionRequestAction](c, req.Action)
	if !ok {
		return
	}
	res, err := h.services.Task.ToggleTaskCompletion(c.Request.Context(), userID, taskID, req.TargetDate.Time, appAction)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, res)
}
