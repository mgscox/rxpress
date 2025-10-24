package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/rxpress/rxpress-bridge-go/bridge"
)

var (
	positive = []string{"great", "good", "love", "fantastic", "amazing", "happy"}
	negative = []string{"bad", "terrible", "hate", "awful", "sad", "angry"}
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("bridge exited: %v", err)
	}
}

func run() error {
	bind := getenv("BRIDGE_BIND", "127.0.0.1:52055")
	controlTarget := getenv("CONTROL_TARGET", "127.0.0.1:52070")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	app, err := bridge.Serve(ctx, bind, controlTarget, map[string]bridge.Handler{
		"sentiment.analyse": analyse,
	}, nil)
	if err != nil {
		return err
	}

	log.Printf("[INFO] Go sentiment bridge listening on %s (control %s)", bind, controlTarget)
	return app.Wait()
}

func analyse(ctx context.Context, _ string, input map[string]any, meta map[string]any, bridgeCtx *bridge.Context) (map[string]any, error) {
	body := mapStringAny(input["body"])
	text := strings.TrimSpace(stringAny(body["text"]))
	language := normalizeLanguage(body["language"])
	var languageValue any
	if language != "" {
		languageValue = language
	}

	score := scoreText(text)
	confidence := confidence(score)
	breakdown := breakdown(text)

	_ = bridgeCtx.Log("info", "sentiment analysed", map[string]any{
		"score":      score,
		"confidence": confidence,
		"length":     len(text),
		"traceId":    meta["trace_id"],
	})

	return map[string]any{
		"status": 200,
		"body": map[string]any{
			"text":       text,
			"language":   languageValue,
			"polarity":   score,
			"confidence": confidence,
			"breakdown":  breakdown,
			"provider":   "go-bridge-stub",
			"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
		},
	}, nil
}

func scoreText(text string) float64 {
	if text == "" {
		return 0
	}
	lowered := strings.ToLower(text)
	score := 0
	for _, token := range positive {
		if strings.Contains(lowered, token) {
			score++
		}
	}
	for _, token := range negative {
		if strings.Contains(lowered, token) {
			score--
		}
	}
	if score == 0 {
		return 0
	}
	val := float64(score) / 3.0
	if val > 1 {
		return 1
	}
	if val < -1 {
		return -1
	}
	return val
}

func confidence(score float64) float64 {
	if score == 0 {
		return 0.3
	}
	if score < 0 {
		score = -score
	}
	if score > 1 {
		return 1
	}
	return score
}

func breakdown(text string) []map[string]any {
	if text == "" {
		return []map[string]any{}
	}
	separators := strings.NewReplacer("!", ".", "?", ".")
	normalised := separators.Replace(text)
	segments := strings.Split(normalised, ".")
	result := make([]map[string]any, 0, len(segments))
	for _, raw := range segments {
		s := strings.TrimSpace(raw)
		if s == "" {
			continue
		}
		result = append(result, map[string]any{
			"sentence": s,
			"score":    scoreText(s),
		})
	}
	return result
}

func mapStringAny(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func stringAny(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	default:
		return ""
	}
}

func normalizeLanguage(value any) string {
	text := strings.TrimSpace(stringAny(value))
	return text
}

func getenv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return val
	}
	return fallback
}
