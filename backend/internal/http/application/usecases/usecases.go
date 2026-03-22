package usecases

import "github.com/megu/kaji-challenge/backend/internal/http/application/ports"

type authUsecase struct{ repo ports.AuthRepository }
type teamUsecase struct{ repo ports.TeamRepository }
type taskUsecase struct{ repo ports.TaskRepository }
type penaltyUsecase struct{ repo ports.PenaltyRepository }
type shoppingListUsecase struct{ repo ports.ShoppingListRepository }
type taskOverviewUsecase struct{ repo ports.TaskOverviewRepository }
type adminUsecase struct{ repo ports.AdminRepository }

func NewServices(deps ports.Dependencies) *ports.Services {
	return &ports.Services{
		Auth:         authUsecase{repo: deps.AuthRepo},
		Team:         teamUsecase{repo: deps.TeamRepo},
		Task:         taskUsecase{repo: deps.TaskRepo},
		Penalty:      penaltyUsecase{repo: deps.PenaltyRepo},
		ShoppingList: shoppingListUsecase{repo: deps.ShoppingListRepo},
		TaskOverview: taskOverviewUsecase{repo: deps.TaskOverviewRepo},
		Admin:        adminUsecase{repo: deps.AdminRepo},
	}
}
