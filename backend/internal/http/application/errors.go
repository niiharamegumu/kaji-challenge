package application

import "errors"

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrNotFound     = errors.New("not_found")
	ErrInvalid      = errors.New("invalid_request")
	ErrConflict     = errors.New("conflict")
	ErrInternal     = errors.New("internal_error")
)
