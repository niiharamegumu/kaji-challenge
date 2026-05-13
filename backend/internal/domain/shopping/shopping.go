package shopping

import (
	"errors"
	"strings"
)

func NormalizeItemName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", errors.New("name is required")
	}
	return name, nil
}

func NormalizePatchItemName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", errors.New("name cannot be empty")
	}
	return name, nil
}
