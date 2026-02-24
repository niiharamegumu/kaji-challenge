package store

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func toPgTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func toPgDate(t time.Time) pgtype.Date {
	return pgtype.Date{Time: t, Valid: true}
}

func textFromPtr(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

func ptrFromText(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	s := t.String
	return &s
}

func ptrFromTimestamptz(t pgtype.Timestamptz, loc *time.Location) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time.In(loc)
	return &v
}

func uuidStringFromPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func ptrFromUUIDString(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	v := s
	return &v
}

func ptrFromAny(v interface{}) *string {
	switch x := v.(type) {
	case nil:
		return nil
	case string:
		return ptrFromUUIDString(x)
	case []byte:
		return ptrFromUUIDString(string(x))
	default:
		return nil
	}
}

func safeInt32(v int, field string) (int32, error) {
	if v < math.MinInt32 || v > math.MaxInt32 {
		return 0, fmt.Errorf("%s is out of int32 range", field)
	}
	return int32(v), nil
}

func safeInt64ToInt32(v int64, field string) (int32, error) {
	if v < math.MinInt32 || v > math.MaxInt32 {
		return 0, fmt.Errorf("%s is out of int32 range", field)
	}
	return int32(v), nil
}

func parseEnvInt32(value, field string, allowZero bool) (int32, error) {
	parsed, err := strconv.ParseInt(value, 10, 32)
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid int32 integer: %q", field, value)
	}
	if allowZero {
		if parsed < 0 {
			return 0, fmt.Errorf("%s must be a non-negative integer: %q", field, value)
		}
	} else if parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer: %q", field, value)
	}
	return int32(parsed), nil
}

func ensureInt32UpperLimit(value int32, field string, upperLimit int32, raw string) error {
	if value > upperLimit {
		return fmt.Errorf("%s must be <= %d: %q", field, upperLimit, raw)
	}
	return nil
}

func dateOnly(t time.Time, loc *time.Location) time.Time {
	tt := t.In(loc)
	return time.Date(tt.Year(), tt.Month(), tt.Day(), 0, 0, 0, 0, loc)
}

func sameDate(a, b time.Time) bool {
	return a.Format("2006-01-02") == b.Format("2006-01-02")
}

func startOfWeek(t time.Time, loc *time.Location) time.Time {
	tt := dateOnly(t, loc)
	offset := (int(tt.Weekday()) + 6) % 7
	return tt.AddDate(0, 0, -offset)
}

func randomToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func toDate(t time.Time) openapi_types.Date {
	return openapi_types.Date{Time: dateOnly(t, t.Location())}
}

func monthKeyFromTime(t time.Time, loc *time.Location) string {
	return t.In(loc).Format("2006-01")
}

func monthStartFromKey(month string, loc *time.Location) (time.Time, error) {
	parsed, err := time.ParseInLocation("2006-01", month, loc)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid month format: %s", month)
	}
	return time.Date(parsed.Year(), parsed.Month(), 1, 0, 0, 0, 0, loc), nil
}
