package store

import (
	"errors"
	"math"
	"slices"
)

const sortKeyStep int32 = 100

func nextSortKeyFromMax(maxSortKey int32) (int32, error) {
	if maxSortKey > math.MaxInt32-sortKeyStep {
		return 0, errors.New("sort key overflow")
	}
	return maxSortKey + sortKeyStep, nil
}

func sortKeyForIndex(index int) (int32, error) {
	value := int64(index+1) * int64(sortKeyStep)
	if value > math.MaxInt32 {
		return 0, errors.New("sort key overflow")
	}
	return int32(value), nil
}

func findMovedItemID(currentIDs, requestedIDs []string) string {
	if slices.Equal(currentIDs, requestedIDs) {
		return ""
	}
	for _, candidate := range requestedIDs {
		if slices.Equal(removeID(currentIDs, candidate), removeID(requestedIDs, candidate)) {
			return candidate
		}
	}
	return ""
}

func removeID(ids []string, target string) []string {
	filtered := make([]string, 0, len(ids)-1)
	removed := false
	for _, id := range ids {
		if !removed && id == target {
			removed = true
			continue
		}
		filtered = append(filtered, id)
	}
	return filtered
}

func computeMovedItemSortKey(requestedIDs []string, currentSortKeys map[string]int32, movedID string) (int32, bool, error) {
	index := slices.Index(requestedIDs, movedID)
	if index == -1 {
		return 0, false, errors.New("itemIds must match current items")
	}

	switch {
	case len(requestedIDs) == 1:
		currentKey, ok := currentSortKeys[movedID]
		if !ok {
			return 0, false, errors.New("itemIds must match current items")
		}
		return currentKey, true, nil
	case index == 0:
		rightKey, ok := currentSortKeys[requestedIDs[1]]
		if !ok {
			return 0, false, errors.New("itemIds must match current items")
		}
		if rightKey <= 1 {
			return 0, false, nil
		}
		return rightKey / 2, true, nil
	case index == len(requestedIDs)-1:
		leftKey, ok := currentSortKeys[requestedIDs[index-1]]
		if !ok {
			return 0, false, errors.New("itemIds must match current items")
		}
		if leftKey > math.MaxInt32-sortKeyStep {
			return 0, false, nil
		}
		return leftKey + sortKeyStep, true, nil
	default:
		leftKey, leftOK := currentSortKeys[requestedIDs[index-1]]
		rightKey, rightOK := currentSortKeys[requestedIDs[index+1]]
		if !leftOK || !rightOK {
			return 0, false, errors.New("itemIds must match current items")
		}
		if leftKey >= rightKey || rightKey-leftKey < 2 {
			return 0, false, nil
		}
		return leftKey + (rightKey-leftKey)/2, true, nil
	}
}
