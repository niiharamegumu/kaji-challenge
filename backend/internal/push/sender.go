package push

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type Payload struct {
	Title    string `json:"title"`
	Body     string `json:"body"`
	Tag      string `json:"tag"`
	Url      string `json:"url"`
	TeamID   string `json:"teamId"`
	SlotKind string `json:"slotKind"`
}

type Subscription struct {
	Endpoint string
	P256DH   string
	Auth     string
}

type Result struct {
	StatusCode int
	Expired    bool
}

type Sender interface {
	Send(ctx context.Context, sub Subscription, payload Payload) (Result, error)
	PublicKey() string
}

type WebPushSender struct {
	publicKey  string
	privateKey string
	subject    string
}

func NewWebPushSenderFromEnv() (*WebPushSender, error) {
	publicKey := strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY"))
	privateKey := strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY"))
	subject := strings.TrimSpace(os.Getenv("VAPID_SUBJECT"))
	if publicKey == "" {
		return nil, fmt.Errorf("VAPID_PUBLIC_KEY is required")
	}
	if privateKey == "" {
		return nil, fmt.Errorf("VAPID_PRIVATE_KEY is required")
	}
	if subject == "" {
		return nil, fmt.Errorf("VAPID_SUBJECT is required")
	}
	return &WebPushSender{
		publicKey:  publicKey,
		privateKey: privateKey,
		subject:    subject,
	}, nil
}

func PublicKeyFromEnv() string {
	return strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY"))
}

func (s *WebPushSender) PublicKey() string {
	if s == nil {
		return ""
	}
	return s.publicKey
}

func (s *WebPushSender) Send(ctx context.Context, sub Subscription, payload Payload) (Result, error) {
	if s == nil {
		return Result{}, fmt.Errorf("push sender is nil")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return Result{}, err
	}
	resp, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256DH,
			Auth:   sub.Auth,
		},
	}, &webpush.Options{
		Subscriber:      s.subject,
		VAPIDPublicKey:  s.publicKey,
		VAPIDPrivateKey: s.privateKey,
		TTL:             60,
	})
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	result := Result{
		StatusCode: resp.StatusCode,
		Expired:    resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound,
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return result, nil
	}
	if result.Expired {
		return result, nil
	}
	return result, fmt.Errorf("web push failed: status=%d", resp.StatusCode)
}
