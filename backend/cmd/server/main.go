package main

import (
	"log"
	"os"

	httpapi "github.com/megu/kaji-challenge/backend/internal/http"
)

func main() {
	r := httpapi.NewRouter()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
