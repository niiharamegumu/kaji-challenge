package main

import (
	"log"
	"os"

	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres"
	"github.com/megu/kaji-challenge/backend/internal/adapter/transport"
)

func main() {
	store := postgres.NewStore()
	r := transport.NewRouter(postgres.NewServices(store), store)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
