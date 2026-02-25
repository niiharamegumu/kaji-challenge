package store

import (
	"sync"
	"sync/atomic"
	"time"
)

type TeamEvent struct {
	TeamID    string            `json:"teamId"`
	Entity    string            `json:"entity"`
	Revision  int64             `json:"revision"`
	ChangedAt time.Time         `json:"changedAt"`
	Hints     map[string]string `json:"hints,omitempty"`
}

type teamEventHub struct {
	mu          sync.RWMutex
	subscribers map[string]map[uint64]chan TeamEvent
	teamCounts  map[string]int64
	nextID      uint64

	subscriberCount int64
	droppedTotal    uint64
}

func newTeamEventHub() *teamEventHub {
	return &teamEventHub{
		subscribers: map[string]map[uint64]chan TeamEvent{},
		teamCounts:  map[string]int64{},
	}
}

func (h *teamEventHub) subscribe(teamID string) (uint64, <-chan TeamEvent, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.nextID++
	subID := h.nextID
	ch := make(chan TeamEvent, 16)
	if h.subscribers[teamID] == nil {
		h.subscribers[teamID] = map[uint64]chan TeamEvent{}
	}
	h.subscribers[teamID][subID] = ch
	h.teamCounts[teamID]++
	atomic.AddInt64(&h.subscriberCount, 1)
	cancel := func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		teamSubs := h.subscribers[teamID]
		if teamSubs == nil {
			return
		}
		_, ok := teamSubs[subID]
		if !ok {
			return
		}
		delete(teamSubs, subID)
		h.teamCounts[teamID]--
		atomic.AddInt64(&h.subscriberCount, -1)
		if len(teamSubs) == 0 {
			delete(h.subscribers, teamID)
			delete(h.teamCounts, teamID)
		}
	}
	return subID, ch, cancel
}

func (h *teamEventHub) publish(event TeamEvent) {
	h.mu.RLock()
	teamSubs := h.subscribers[event.TeamID]
	if len(teamSubs) == 0 {
		h.mu.RUnlock()
		return
	}
	targets := make([]chan TeamEvent, 0, len(teamSubs))
	for _, ch := range teamSubs {
		targets = append(targets, ch)
	}
	h.mu.RUnlock()

	for _, ch := range targets {
		select {
		case ch <- event:
		default:
			// Drop when the subscriber is slow; it will recover by full refetch.
			atomic.AddUint64(&h.droppedTotal, 1)
		}
	}
}

func (h *teamEventHub) teamSubscriberCount(teamID string) int64 {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.teamCounts[teamID]
}

func (h *teamEventHub) totalSubscriberCount() int64 {
	return atomic.LoadInt64(&h.subscriberCount)
}

func (h *teamEventHub) droppedEventTotal() uint64 {
	return atomic.LoadUint64(&h.droppedTotal)
}
