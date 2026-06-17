package push

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
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
	APNSID     string
	Location   string
	RetryAfter string
	Body       string
}

type Sender interface {
	Send(ctx context.Context, sub Subscription, payload Payload) (Result, error)
	PublicKey() string
}

type PortsSender struct {
	Sender Sender
}

func AsPortsSender(sender Sender) PortsSender {
	return PortsSender{Sender: sender}
}

func (s PortsSender) Send(ctx context.Context, sub ports.PushSubscriptionEndpoint, payload ports.PushPayload) (ports.PushResult, error) {
	result, err := s.Sender.Send(ctx, Subscription{
		Endpoint: sub.Endpoint,
		P256DH:   sub.P256DH,
		Auth:     sub.Auth,
	}, Payload{
		Title:    payload.Title,
		Body:     payload.Body,
		Tag:      payload.Tag,
		Url:      payload.URL,
		TeamID:   payload.TeamID,
		SlotKind: payload.SlotKind,
	})
	return ports.PushResult{
		StatusCode: result.StatusCode,
		Expired:    result.Expired,
		APNSID:     result.APNSID,
		Location:   result.Location,
		RetryAfter: result.RetryAfter,
		Body:       result.Body,
	}, err
}

type WebPushSender struct {
	publicKey  string
	privateKey string
	subject    string
}

const (
	webPushTTLSeconds     = 3600
	webPushBodyLogMaxSize = 1024
	webPushUrgency        = webpush.UrgencyHigh
)

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
	}, s.optionsForPayload(payload))
	if err != nil {
		return Result{}, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	bodyBytes, readErr := io.ReadAll(io.LimitReader(resp.Body, webPushBodyLogMaxSize))
	if readErr != nil {
		return Result{}, fmt.Errorf("failed to read web push response body: %w", readErr)
	}

	result := resultFromResponse(resp, bodyBytes)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return result, nil
	}
	if result.Expired {
		return result, nil
	}
	return result, fmt.Errorf("web push failed: status=%d", resp.StatusCode)
}

func (s *WebPushSender) optionsForPayload(payload Payload) *webpush.Options {
	return &webpush.Options{
		Subscriber:      s.subject,
		Topic:           topicForPayload(payload),
		TTL:             webPushTTLSeconds,
		Urgency:         webPushUrgency,
		VAPIDPublicKey:  s.publicKey,
		VAPIDPrivateKey: s.privateKey,
	}
}

func topicForPayload(payload Payload) string {
	sum := sha256.Sum256([]byte(payload.Tag))
	return base64.RawURLEncoding.EncodeToString(sum[:16])
}

func resultFromResponse(resp *http.Response, body []byte) Result {
	return Result{
		StatusCode: resp.StatusCode,
		Expired:    resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound,
		APNSID:     strings.TrimSpace(resp.Header.Get("apns-id")),
		Location:   strings.TrimSpace(resp.Header.Get("location")),
		RetryAfter: strings.TrimSpace(resp.Header.Get("retry-after")),
		Body:       strings.TrimSpace(string(body)),
	}
}
