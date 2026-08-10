package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	oidcauth "github.com/megu/kaji-challenge/backend/internal/adapter/external/oidc"
	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres"
	"github.com/megu/kaji-challenge/backend/internal/adapter/transport"
)

const (
	defaultPort         = "8080"
	readHeaderTimeout   = 5 * time.Second
	readTimeout         = 15 * time.Second
	writeTimeout        = 60 * time.Second
	idleTimeout         = 60 * time.Second
	gracefulStopTimeout = 10 * time.Second
)

func main() {
	if err := run(); err != nil {
		log.Printf("server failed: %v", err)
		os.Exit(1)
	}
}

func run() error {
	store := postgres.NewStore()
	defer store.Close()
	r := transport.NewRouter(postgres.NewServices(store, oidcauth.NewProvider()), store)

	addr, err := serverAddress(os.Getenv("PORT"))
	if err != nil {
		return err
	}
	server := newHTTPServer(addr, r)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Print("server listening")
	return serve(ctx, server)
}

func serverAddress(rawPort string) (string, error) {
	port := strings.TrimSpace(rawPort)
	if port == "" {
		port = defaultPort
	}
	parsed, err := strconv.Atoi(port)
	if err != nil || parsed < 1 || parsed > 65535 {
		return "", fmt.Errorf("PORT must be an integer between 1 and 65535: %q", port)
	}
	return net.JoinHostPort("", port), nil
}

func newHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}
}

func serve(ctx context.Context, server *http.Server) error {
	errCh := make(chan error, 1)
	go func() {
		errCh <- server.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), gracefulStopTimeout)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			return fmt.Errorf("graceful shutdown: %w", err)
		}
		err := <-errCh
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}
