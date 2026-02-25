package application

import "errors"

var (
	ErrUnauthorized         = errors.New("unauthorized")
	ErrForbidden            = errors.New("forbidden")
	ErrNotFound             = errors.New("not_found")
	ErrInvalid              = errors.New("invalid_request")
	ErrConflict             = errors.New("conflict")
	ErrPreconditionRequired = errors.New("precondition_required")
	ErrPrecondition         = errors.New("precondition_failed")
	ErrInternal             = errors.New("internal_error")
)

type PreconditionRequiredError struct {
	Message string
}

func (e *PreconditionRequiredError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return "If-Match header is required"
}

func (e *PreconditionRequiredError) Unwrap() error {
	return ErrPreconditionRequired
}

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
