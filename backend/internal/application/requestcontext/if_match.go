package requestcontext

import (
	"context"
	"strings"
)

type ifMatchContextKey struct{}

func WithIfMatch(ctx context.Context, ifMatch string) context.Context {
	return context.WithValue(ctx, ifMatchContextKey{}, strings.TrimSpace(ifMatch))
}

func IfMatch(ctx context.Context) string {
	value, _ := ctx.Value(ifMatchContextKey{}).(string)
	return strings.TrimSpace(value)
}
