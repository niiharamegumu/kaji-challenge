package push

import (
	"net/http"
	"regexp"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func TestOptionsForPayloadUsesReminderDefaults(t *testing.T) {
	sender := &WebPushSender{
		publicKey:  "public-key",
		privateKey: "private-key",
		subject:    "mailto:test@example.com",
	}

	options := sender.optionsForPayload(Payload{
		Tag: "team:1:daily_2100:2026-04-04",
	})

	if options.Subscriber != "mailto:test@example.com" {
		t.Fatalf("unexpected subscriber: %q", options.Subscriber)
	}
	if matched := regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`).MatchString(options.Topic); !matched {
		t.Fatalf("unexpected topic format: %q", options.Topic)
	}
	if options.Topic != topicForPayload(Payload{Tag: "team:1:daily_2100:2026-04-04"}) {
		t.Fatalf("unexpected topic: %q", options.Topic)
	}
	if options.TTL != webPushTTLSeconds {
		t.Fatalf("unexpected ttl: %d", options.TTL)
	}
	if options.Urgency != webpush.UrgencyHigh {
		t.Fatalf("unexpected urgency: %q", options.Urgency)
	}
	if options.VAPIDPublicKey != "public-key" || options.VAPIDPrivateKey != "private-key" {
		t.Fatalf("unexpected vapid keys: %+v", options)
	}
}

func TestResultFromResponseIncludesHeadersAndBody(t *testing.T) {
	headers := http.Header{}
	headers.Set("apns-id", "apns-123")
	headers.Set("location", "https://example.com/messages/1")
	headers.Set("retry-after", "60")
	response := &http.Response{
		StatusCode: http.StatusCreated,
		Header:     headers,
	}

	result := resultFromResponse(response, []byte("accepted"))

	if result.StatusCode != http.StatusCreated {
		t.Fatalf("unexpected status code: %d", result.StatusCode)
	}
	if result.Expired {
		t.Fatalf("expected non-expired result")
	}
	if result.APNSID != "apns-123" {
		t.Fatalf("unexpected apns id: %q", result.APNSID)
	}
	if result.Location != "https://example.com/messages/1" {
		t.Fatalf("unexpected location: %q", result.Location)
	}
	if result.RetryAfter != "60" {
		t.Fatalf("unexpected retry-after: %q", result.RetryAfter)
	}
	if result.Body != "accepted" {
		t.Fatalf("unexpected body: %q", result.Body)
	}
}

func TestResultFromResponseMarksExpiredStatuses(t *testing.T) {
	for _, statusCode := range []int{http.StatusNotFound, http.StatusGone} {
		result := resultFromResponse(&http.Response{
			StatusCode: statusCode,
			Header:     http.Header{},
		}, nil)
		if !result.Expired {
			t.Fatalf("expected status %d to be expired", statusCode)
		}
	}
}
