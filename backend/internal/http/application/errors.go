package application

import "errors"

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
	ErrNotFound     = errors.New("not_found")
	ErrInvalid      = errors.New("invalid_request")
	ErrConflict     = errors.New("conflict")
	ErrPrecondition = errors.New("precondition_failed")
	ErrInternal     = errors.New("internal_error")
)

type PreconditionError struct {
	Message     string
	CurrentETag string
}

func (e *PreconditionError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return "precondition failed"
}

func (e *PreconditionError) Unwrap() error {
	return ErrPrecondition
}
