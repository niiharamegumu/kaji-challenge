package usecases

import "github.com/megu/kaji-challenge/backend/internal/application/ports"

type authUsecase struct{ repo ports.AuthRepository }
type teamUsecase struct{ repo ports.TeamRepository }
type pushUsecase struct{ repo ports.PushRepository }
type taskUsecase struct{ repo ports.TaskRepository }
type penaltyUsecase struct{ repo ports.PenaltyRepository }
type shoppingListUsecase struct{ repo ports.ShoppingListRepository }
type reminderUsecase struct{ repo ports.ReminderRepository }
type taskOverviewUsecase struct{ repo ports.TaskOverviewRepository }
type adminUsecase struct{ repo ports.AdminRepository }

func NewServices(deps ports.Dependencies) *ports.Services {
	return &ports.Services{
		Auth:         authUsecase{repo: deps.AuthRepo},
		Team:         teamUsecase{repo: deps.TeamRepo},
		Push:         pushUsecase{repo: deps.PushRepo},
		Task:         taskUsecase{repo: deps.TaskRepo},
		Penalty:      penaltyUsecase{repo: deps.PenaltyRepo},
		ShoppingList: shoppingListUsecase{repo: deps.ShoppingListRepo},
		Reminder:     reminderUsecase{repo: deps.ReminderRepo},
		TaskOverview: taskOverviewUsecase{repo: deps.TaskOverviewRepo},
		Admin:        adminUsecase{repo: deps.AdminRepo},
	}
}
