package repositories

import (
	"fmt"
	"strings"

	"github.com/megu/kaji-challenge/backend/internal/http/application"
)

func mapInfraErr(err error) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "missing bearer token"),
		strings.Contains(msg, "invalid bearer token"),
		strings.Contains(msg, "missing session cookie"),
		strings.Contains(msg, "invalid session cookie"):
		return fmt.Errorf("%w: %v", application.ErrUnauthorized, err)
	case strings.Contains(msg, "not found"):
		return fmt.Errorf("%w: %v", application.ErrNotFound, err)
	case strings.Contains(msg, "max uses exceeded"),
		strings.Contains(msg, "already belongs to a team"),
		strings.Contains(msg, "duplicate key value violates unique constraint"):
		return fmt.Errorf("%w: %v", application.ErrConflict, err)
	case strings.Contains(msg, "violates foreign key constraint"),
		strings.Contains(msg, "violates check constraint"):
		return fmt.Errorf("%w: %v", application.ErrInvalid, err)
	case strings.Contains(msg, "invalid"), strings.Contains(msg, "expired"), strings.Contains(msg, "disabled"), strings.Contains(msg, "required"):
		return fmt.Errorf("%w: %v", application.ErrInvalid, err)
	default:
		return fmt.Errorf("%w: %v", application.ErrInternal, err)
	}
}
