package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestLoadCriticalIDs(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "critical_goids.txt")
	content := strings.Join([]string{
		"# comment",
		"",
		"GO-2026-4337",
		"  GO-2026-4441  ",
	}, "\n")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}

	got, err := loadCriticalIDs(path)
	if err != nil {
		t.Fatalf("loadCriticalIDs returned error: %v", err)
	}

	want := map[string]struct{}{
		"GO-2026-4337": {},
		"GO-2026-4441": {},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected allowlist: got=%v want=%v", got, want)
	}
}

func TestCollectReachableVulns(t *testing.T) {
	t.Parallel()

	input := strings.Join([]string{
		`{"osv":{"id":"GO-2026-4337","summary":"tls issue"}}`,
		`{"osv":{"id":"GO-2026-4441","summary":"x/net issue"}}`,
		`{"finding":{"osv":"GO-2026-4441"}}`,
		`{"finding":{"osv":"GO-2026-4337"}}`,
		`{"finding":{"osv":"GO-2026-4337"}}`,
	}, "\n")

	reachableIDs, summaries, err := collectReachableVulns(strings.NewReader(input))
	if err != nil {
		t.Fatalf("collectReachableVulns returned error: %v", err)
	}

	wantReachable := []string{"GO-2026-4337", "GO-2026-4441"}
	if !reflect.DeepEqual(reachableIDs, wantReachable) {
		t.Fatalf("unexpected reachable IDs: got=%v want=%v", reachableIDs, wantReachable)
	}

	if summaries["GO-2026-4337"] != "tls issue" {
		t.Fatalf("missing summary for GO-2026-4337: got=%q", summaries["GO-2026-4337"])
	}
	if summaries["GO-2026-4441"] != "x/net issue" {
		t.Fatalf("missing summary for GO-2026-4441: got=%q", summaries["GO-2026-4441"])
	}
}

func TestMatchCriticalFindings(t *testing.T) {
	t.Parallel()

	reachable := []string{"GO-2025-3503", "GO-2026-4337", "GO-2026-4440"}
	allowlist := map[string]struct{}{
		"GO-2026-4337": {},
		"GO-2026-4441": {},
	}

	got := matchCriticalFindings(reachable, allowlist)
	want := []string{"GO-2026-4337"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected matches: got=%v want=%v", got, want)
	}
}
