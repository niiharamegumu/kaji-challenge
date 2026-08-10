package main

import (
	"net/http"
	"testing"
)

func TestServerAddress(t *testing.T) {
	tests := []struct {
		name    string
		port    string
		want    string
		wantErr bool
	}{
		{name: "default", want: ":8080"},
		{name: "configured", port: " 9090 ", want: ":9090"},
		{name: "not numeric", port: "http", wantErr: true},
		{name: "zero", port: "0", wantErr: true},
		{name: "too large", port: "65536", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := serverAddress(tt.port)
			if (err != nil) != tt.wantErr {
				t.Fatalf("serverAddress(%q) error = %v, wantErr %v", tt.port, err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("serverAddress(%q) = %q, want %q", tt.port, got, tt.want)
			}
		})
	}
}

func TestNewHTTPServerConfiguresResourceTimeouts(t *testing.T) {
	server := newHTTPServer(":8080", http.NewServeMux())
	if server.ReadHeaderTimeout != readHeaderTimeout || server.ReadTimeout != readTimeout {
		t.Fatalf("read timeouts = (%s, %s)", server.ReadHeaderTimeout, server.ReadTimeout)
	}
	if server.WriteTimeout != writeTimeout || server.IdleTimeout != idleTimeout {
		t.Fatalf("write/idle timeouts = (%s, %s)", server.WriteTimeout, server.IdleTimeout)
	}
}
