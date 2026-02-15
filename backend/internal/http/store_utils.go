package http

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
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
