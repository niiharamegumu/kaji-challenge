package push

import (
	"context"
	"errors"
	"testing"

	"github.com/megu/kaji-challenge/backend/internal/application/ports"
)

type fakeSender struct {
	sub     Subscription
	payload Payload
	result  Result
	err     error
}

func (f *fakeSender) Send(_ context.Context, sub Subscription, payload Payload) (Result, error) {
	f.sub = sub
	f.payload = payload
	return f.result, f.err
}

func (f *fakeSender) PublicKey() string { return "public" }

func TestAsPortsSenderMapsPayloadSubscriptionAndResult(t *testing.T) {
	sender := &fakeSender{result: Result{StatusCode: 201, Expired: true, APNSID: "apns", Location: "loc", RetryAfter: "10", Body: "body"}}
	adapter := AsPortsSender(sender)

	result, err := adapter.Send(context.Background(), ports.PushSubscriptionEndpoint{
		Endpoint: "endpoint", P256DH: "p256dh", Auth: "auth",
	}, ports.PushPayload{
		Title: "title", Body: "body", Tag: "tag", URL: "/", TeamID: "team-1", SlotKind: "daily_2100",
	})
	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}
	if sender.sub.Endpoint != "endpoint" || sender.sub.P256DH != "p256dh" || sender.sub.Auth != "auth" {
		t.Fatalf("unexpected mapped subscription: %+v", sender.sub)
	}
	if sender.payload.Url != "/" || sender.payload.TeamID != "team-1" || sender.payload.SlotKind != "daily_2100" {
		t.Fatalf("unexpected mapped payload: %+v", sender.payload)
	}
	if result.StatusCode != 201 || !result.Expired || result.APNSID != "apns" || result.Body != "body" {
		t.Fatalf("unexpected mapped result: %+v", result)
	}
}

func TestAsPortsSenderPropagatesError(t *testing.T) {
	wantErr := errors.New("send failed")
	_, err := AsPortsSender(&fakeSender{err: wantErr}).Send(context.Background(), ports.PushSubscriptionEndpoint{}, ports.PushPayload{})
	if !errors.Is(err, wantErr) {
		t.Fatalf("Send error = %v, want %v", err, wantErr)
	}
}

func TestWebPushSenderEnvAndPublicKey(t *testing.T) {
	t.Setenv("VAPID_PUBLIC_KEY", " public ")
	t.Setenv("VAPID_PRIVATE_KEY", " private ")
	t.Setenv("VAPID_SUBJECT", " mailto:test@example.com ")

	if got := PublicKeyFromEnv(); got != "public" {
		t.Fatalf("PublicKeyFromEnv = %q", got)
	}
	sender, err := NewWebPushSenderFromEnv()
	if err != nil {
		t.Fatalf("NewWebPushSenderFromEnv failed: %v", err)
	}
	if sender.PublicKey() != "public" {
		t.Fatalf("PublicKey = %q", sender.PublicKey())
	}
	if (*WebPushSender)(nil).PublicKey() != "" {
		t.Fatal("expected nil sender public key to be empty")
	}
}

func TestWebPushSenderEnvRequiresAllValuesAndRejectsNilSend(t *testing.T) {
	t.Setenv("VAPID_PUBLIC_KEY", "")
	t.Setenv("VAPID_PRIVATE_KEY", "private")
	t.Setenv("VAPID_SUBJECT", "subject")
	if _, err := NewWebPushSenderFromEnv(); err == nil {
		t.Fatal("expected missing public key to fail")
	}
	if _, err := (*WebPushSender)(nil).Send(context.Background(), Subscription{}, Payload{}); err == nil {
		t.Fatal("expected nil sender Send to fail")
	}
}
