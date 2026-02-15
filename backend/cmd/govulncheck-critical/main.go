package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
)

type govulncheckEvent struct {
	OSV *struct {
		ID      string `json:"id"`
		Summary string `json:"summary"`
	} `json:"osv"`
	Finding *struct {
		OSV string `json:"osv"`
	} `json:"finding"`
}

func main() {
	criticalFile := flag.String("critical-file", "security/critical_goids.txt", "path to GO-ID allowlist file")
	flag.Parse()

	criticalIDs, err := loadCriticalIDs(*criticalFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "govulncheck-critical: warning: failed to read allowlist (%v), skipping fail gate\n", err)
		return
	}

	reachableIDs, summaries, err := collectReachableVulns(os.Stdin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "govulncheck-critical: warning: failed to parse govulncheck json (%v), skipping fail gate\n", err)
		return
	}

	if len(reachableIDs) == 0 {
		fmt.Println("govulncheck-critical: no reachable vulnerabilities")
		return
	}

	criticalFindings := matchCriticalFindings(reachableIDs, criticalIDs)
	if len(criticalFindings) == 0 {
		fmt.Printf("govulncheck-critical: reachable vulnerabilities found (%d), no critical match\n", len(reachableIDs))
		return
	}

	fmt.Fprintf(os.Stderr, "govulncheck-critical: critical vulnerabilities detected (%d)\n", len(criticalFindings))
	for _, id := range criticalFindings {
		summary := summaries[id]
		if summary == "" {
			fmt.Fprintf(os.Stderr, "- %s\n", id)
			continue
		}
		fmt.Fprintf(os.Stderr, "- %s: %s\n", id, summary)
	}
	os.Exit(1)
}

func loadCriticalIDs(path string) (map[string]struct{}, error) {
	// #nosec G304 -- The path is controlled by repository config or explicit operator input.
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	ids := make(map[string]struct{})
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		ids[line] = struct{}{}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}

func collectReachableVulns(r io.Reader) ([]string, map[string]string, error) {
	decoder := json.NewDecoder(r)
	reachableSet := make(map[string]struct{})
	summaries := make(map[string]string)

	for {
		var event govulncheckEvent
		if err := decoder.Decode(&event); err != nil {
			if err == io.EOF {
				break
			}
			return nil, nil, err
		}

		if event.OSV != nil {
			if event.OSV.ID != "" && event.OSV.Summary != "" {
				summaries[event.OSV.ID] = event.OSV.Summary
			}
		}

		if event.Finding != nil && event.Finding.OSV != "" {
			reachableSet[event.Finding.OSV] = struct{}{}
		}
	}

	reachableIDs := make([]string, 0, len(reachableSet))
	for id := range reachableSet {
		reachableIDs = append(reachableIDs, id)
	}
	slices.Sort(reachableIDs)
	return reachableIDs, summaries, nil
}

func matchCriticalFindings(reachableIDs []string, criticalIDs map[string]struct{}) []string {
	matches := make([]string, 0, len(reachableIDs))
	for _, id := range reachableIDs {
		if _, ok := criticalIDs[id]; ok {
			matches = append(matches, id)
		}
	}
	return matches
}
