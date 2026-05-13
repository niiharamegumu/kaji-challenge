package store

import (
	"strings"
	"testing"
)

func TestParseEnvInt32(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		value     string
		field     string
		allowZero bool
		want      int32
		wantErr   string
	}{
		{
			name:      "positive value",
			value:     "16",
			field:     "DB_POOL_MAX_CONNS",
			allowZero: false,
			want:      16,
		},
		{
			name:      "zero allowed",
			value:     "0",
			field:     "DB_POOL_MIN_CONNS",
			allowZero: true,
			want:      0,
		},
		{
			name:      "zero disallowed",
			value:     "0",
			field:     "DB_POOL_MAX_CONNS",
			allowZero: false,
			wantErr:   "positive integer",
		},
		{
			name:      "negative disallowed",
			value:     "-1",
			field:     "DB_POOL_MIN_CONNS",
			allowZero: true,
			wantErr:   "non-negative integer",
		},
		{
			name:      "overflow",
			value:     "2147483648",
			field:     "DB_POOL_MAX_CONNS",
			allowZero: false,
			wantErr:   "valid int32 integer",
		},
		{
			name:      "invalid format",
			value:     "abc",
			field:     "DB_POOL_MAX_CONNS",
			allowZero: false,
			wantErr:   "valid int32 integer",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseEnvInt32(tt.value, tt.field, tt.allowZero)
			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("expected error to contain %q, got %q", tt.wantErr, err.Error())
				}
				if !strings.Contains(err.Error(), tt.field) {
					t.Fatalf("expected error to contain field name %q, got %q", tt.field, err.Error())
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("unexpected value: got=%d want=%d", got, tt.want)
			}
		})
	}
}

func TestEnsureInt32UpperLimit(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		value      int32
		field      string
		upperLimit int32
		raw        string
		wantErr    string
	}{
		{
			name:       "within upper limit",
			value:      100,
			field:      "DB_POOL_MAX_CONNS",
			upperLimit: 100,
			raw:        "100",
		},
		{
			name:       "exceed upper limit",
			value:      101,
			field:      "DB_POOL_MAX_CONNS",
			upperLimit: 100,
			raw:        "101",
			wantErr:    "must be <= 100",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := ensureInt32UpperLimit(tt.value, tt.field, tt.upperLimit, tt.raw)
			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("expected error to contain %q, got %q", tt.wantErr, err.Error())
				}
				if !strings.Contains(err.Error(), tt.field) {
					t.Fatalf("expected error to contain field name %q, got %q", tt.field, err.Error())
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
