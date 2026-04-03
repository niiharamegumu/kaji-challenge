package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type output struct {
	VAPIDPublicKey  string `json:"VAPID_PUBLIC_KEY"`
	VAPIDPrivateKey string `json:"VAPID_PRIVATE_KEY"`
	VAPIDSubject    string `json:"VAPID_SUBJECT"`
}

func main() {
	fs := flag.NewFlagSet("vapid", flag.ExitOnError)
	subject := fs.String("subject", "", "VAPID subject, usually mailto:you@example.com")
	format := fs.String("format", "env", "output format: env|json")
	if err := fs.Parse(os.Args[1:]); err != nil {
		log.Fatal(err)
	}

	finalSubject := strings.TrimSpace(*subject)
	if finalSubject == "" {
		finalSubject = strings.TrimSpace(os.Getenv("VAPID_SUBJECT"))
	}
	if finalSubject == "" {
		finalSubject = "mailto:your-email@example.com"
	}

	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		log.Fatal(err)
	}

	switch strings.ToLower(strings.TrimSpace(*format)) {
	case "env":
		fmt.Printf("VAPID_PUBLIC_KEY=%s\n", publicKey)
		fmt.Printf("VAPID_PRIVATE_KEY=%s\n", privateKey)
		fmt.Printf("VAPID_SUBJECT=%s\n", finalSubject)
	case "json":
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(output{
			VAPIDPublicKey:  publicKey,
			VAPIDPrivateKey: privateKey,
			VAPIDSubject:    finalSubject,
		}); err != nil {
			log.Fatal(err)
		}
	default:
		log.Fatalf("unsupported --format %q (expected env|json)", *format)
	}
}
