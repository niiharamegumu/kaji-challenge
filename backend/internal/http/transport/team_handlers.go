package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (h *Handler) GetMe(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	res, err := h.services.Team.GetMe(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusUnauthorized)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PatchMeNickname(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.UpdateNicknameRequest](c)
	if !ok {
		return
	}
	res, err := h.services.Team.PatchMeNickname(c.Request.Context(), userID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostTeamInvite(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	var req api.CreateInviteRequest
	if c.Request.ContentLength > 0 {
		v, ok := bindJSON[api.CreateInviteRequest](c)
		if !ok {
			return
		}
		req = v
	}
	invite, err := h.services.Team.CreateInvite(c.Request.Context(), userID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusCreated, invite)
}

func (h *Handler) GetTeamCurrentInvite(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	invite, err := h.services.Team.GetTeamCurrentInvite(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusNotFound)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, invite)
}

func (h *Handler) PatchTeamCurrent(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.UpdateCurrentTeamRequest](c)
	if !ok {
		return
	}
	res, err := h.services.Team.PatchTeamCurrent(c.Request.Context(), userID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetTeamCurrentMembers(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	res, err := h.services.Team.GetTeamCurrentMembers(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostTeamJoin(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.JoinTeamRequest](c)
	if !ok {
		return
	}
	res, err := h.services.Team.JoinTeam(c.Request.Context(), userID, req.Code)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostTeamLeave(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	res, err := h.services.Team.PostTeamLeave(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}
