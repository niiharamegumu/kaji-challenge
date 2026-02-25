package store

import "testing"

func TestTeamEventHubCancelThenPublishDoesNotPanic(t *testing.T) {
	hub := newTeamEventHub()
	_, _, cancel := hub.subscribe("team-1")
	cancel()

	hub.publish(TeamEvent{TeamID: "team-1", Entity: "task", Revision: 1})
}

func TestTeamEventHubTracksSubscribers(t *testing.T) {
	hub := newTeamEventHub()
	_, _, cancelA := hub.subscribe("team-1")
	_, _, cancelB := hub.subscribe("team-1")
	_, _, cancelC := hub.subscribe("team-2")

	if got := hub.totalSubscriberCount(); got != 3 {
		t.Fatalf("expected total subscribers 3, got %d", got)
	}
	if got := hub.teamSubscriberCount("team-1"); got != 2 {
		t.Fatalf("expected team-1 subscribers 2, got %d", got)
	}
	if got := hub.teamSubscriberCount("team-2"); got != 1 {
		t.Fatalf("expected team-2 subscribers 1, got %d", got)
	}

	cancelA()
	cancelB()
	cancelC()

	if got := hub.totalSubscriberCount(); got != 0 {
		t.Fatalf("expected total subscribers 0 after cancel, got %d", got)
	}
}

func TestTeamEventHubCountsDroppedEventsForSlowSubscribers(t *testing.T) {
	hub := newTeamEventHub()
	_, _, cancel := hub.subscribe("team-1")
	defer cancel()

	for i := 0; i < 32; i++ {
		hub.publish(TeamEvent{TeamID: "team-1", Entity: "task", Revision: int64(i + 1)})
	}
	if got := hub.droppedEventTotal(); got == 0 {
		t.Fatalf("expected dropped events to be counted")
	}
}
