package team

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

func NormalizeNickname(raw string) (string, error) {
	nickname := strings.TrimSpace(raw)
	if nickname == "" {
		return "", nil
	}
	if count := utf8.RuneCountInString(nickname); count > 30 {
		return "", fmt.Errorf("nickname must be %d characters or fewer", 30)
	}
	return nickname, nil
}

func NormalizeName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", errors.New("team name is required")
	}
	if count := utf8.RuneCountInString(name); count < 1 || count > 50 {
		return "", fmt.Errorf("team name must be between %d and %d characters", 1, 50)
	}
	return name, nil
}

func NormalizeColorHex(raw *string) (string, error) {
	if raw == nil {
		return "", nil
	}
	color := strings.ToUpper(strings.TrimSpace(*raw))
	if color == "" {
		return "", errors.New("colorHex must be null or #RRGGBB")
	}
	if len(color) != 7 || color[0] != '#' {
		return "", errors.New("colorHex must match #RRGGBB")
	}
	for _, r := range color[1:] {
		isDigit := r >= '0' && r <= '9'
		isUpperHex := r >= 'A' && r <= 'F'
		if !isDigit && !isUpperHex {
			return "", errors.New("colorHex must match #RRGGBB")
		}
	}
	return color, nil
}

func EffectiveName(displayName, nickname string) string {
	trimmedNickname := strings.TrimSpace(nickname)
	if trimmedNickname != "" {
		return trimmedNickname
	}
	trimmedDisplayName := strings.TrimSpace(displayName)
	if trimmedDisplayName != "" {
		return trimmedDisplayName
	}
	return "User"
}

func DefaultOwnTeamName(base string) string {
	name := strings.TrimSpace(base)
	if name == "" {
		name = "My Team"
	}
	name = name + " Team"
	if utf8.RuneCountInString(name) > 50 {
		runes := []rune(name)
		name = string(runes[:50])
	}
	return name
}
