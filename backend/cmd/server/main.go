package main

import (
	"log"
	"os"

	oidcauth "github.com/megu/kaji-challenge/backend/internal/adapter/external/oidc"
	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres"
	"github.com/megu/kaji-challenge/backend/internal/adapter/transport"
)

func main() {
	store := postgres.NewStore()
	r := transport.NewRouter(postgres.NewServices(store, oidcauth.NewProvider()), store)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
