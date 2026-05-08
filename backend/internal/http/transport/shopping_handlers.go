package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/http/application/model"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (h *Handler) ListShoppingItems(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	items, err := h.services.ShoppingList.ListShoppingItems(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostShoppingItem(c *gin.Context, _ api.PostShoppingItemParams) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.CreateShoppingListItemRequest](c)
	if !ok {
		return
	}
	appReq, ok := convertTransportModel[model.CreateShoppingListItemRequest](c, req)
	if !ok {
		return
	}
	item, err := h.services.ShoppingList.CreateShoppingItem(c.Request.Context(), userID, appReq)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) PatchShoppingItem(c *gin.Context, itemID string, _ api.PatchShoppingItemParams) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.UpdateShoppingListItemRequest](c)
	if !ok {
		return
	}
	appReq, ok := convertTransportModel[model.UpdateShoppingListItemRequest](c, req)
	if !ok {
		return
	}
	item, err := h.services.ShoppingList.PatchShoppingItem(c.Request.Context(), userID, itemID, appReq)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, item)
}

func (h *Handler) DeleteShoppingItem(c *gin.Context, itemID string, _ api.DeleteShoppingItemParams) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	if err := h.services.ShoppingList.DeleteShoppingItem(c.Request.Context(), userID, itemID); err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.Status(http.StatusNoContent)
}

func (h *Handler) PostShoppingItemsReorder(c *gin.Context, _ api.PostShoppingItemsReorderParams) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.ReorderShoppingListItemsRequest](c)
	if !ok {
		return
	}
	appReq, ok := convertTransportModel[model.ReorderShoppingListItemsRequest](c, req)
	if !ok {
		return
	}
	items, err := h.services.ShoppingList.ReorderShoppingItems(c.Request.Context(), userID, appReq)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, gin.H{"items": items})
}
