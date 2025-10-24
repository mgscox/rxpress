package bridge

import (
	"context"
	"fmt"
	"time"

	pb "github.com/newintel/rxpress-bridge-go/internal/pb/proto"
)

type Context struct {
	control *controlPlane
	meta    map[string]any
	runID   string
}

func newContext(control *controlPlane, meta map[string]any) *Context {
	ctx := &Context{
		control: control,
		meta:    meta,
	}
	if v, ok := meta["run_id"].(string); ok {
		ctx.runID = v
	}
	return ctx
}

func (c *Context) Log(level, message string, fields map[string]any) error {
	payload := map[string]any{}
	for k, v := range fields {
		payload[k] = v
	}
	if c.runID != "" {
		if _, exists := payload["runId"]; !exists {
			payload["runId"] = c.runID
		}
	}
	encoded, err := encodeMap(payload)
	if err != nil {
		return err
	}
	return c.control.log(toProtoMeta(c.meta), level, message, encoded)
}

func (c *Context) Emit(_ context.Context, topic string, data map[string]any) error {
	encoded, err := encodeMap(data)
	if err != nil {
		return err
	}
	return c.control.emit(toProtoMeta(c.meta), topic, encoded)
}

func (c *Context) KVGet(_ context.Context, bucket, key string) (any, error) {
	return c.control.kvGet(bucket, key)
}

func (c *Context) KVPut(_ context.Context, bucket, key string, value any, ttl time.Duration) error {
	return c.control.kvPut(bucket, key, value, ttl)
}

func (c *Context) KVDel(_ context.Context, bucket, key string) error {
	return c.control.kvDel(bucket, key)
}

func encodeMap(values map[string]any) (map[string]*pb.Value, error) {
	result := make(map[string]*pb.Value, len(values))
	for k, v := range values {
		encoded, err := encodeValue(v)
		if err != nil {
			return nil, fmt.Errorf("encode map value %q: %w", k, err)
		}
		result[k] = encoded
	}
	return result, nil
}

func toProtoMeta(meta map[string]any) *pb.Meta {
	if meta == nil {
		return nil
	}
	message := &pb.Meta{}
	if trace, ok := meta["trace_id"].(string); ok {
		message.TraceId = trace
	}
	if span, ok := meta["span_id"].(string); ok {
		message.SpanId = span
	}
	if tenant, ok := meta["tenant"].(string); ok {
		message.Tenant = tenant
	}
	if baggage, ok := meta["baggage"].(map[string]any); ok {
		if message.Baggage == nil {
			message.Baggage = make(map[string]string, len(baggage))
		}
		for k, v := range baggage {
			message.Baggage[k] = fmt.Sprint(v)
		}
	}
	return message
}

func fromProtoMeta(meta *pb.Meta) map[string]any {
	if meta == nil {
		return map[string]any{}
	}
	result := map[string]any{
		"trace_id": meta.GetTraceId(),
		"span_id":  meta.GetSpanId(),
		"tenant":   meta.GetTenant(),
	}
	if baggage := meta.GetBaggage(); len(baggage) > 0 {
		copy := make(map[string]any, len(baggage))
		for k, v := range baggage {
			copy[k] = v
		}
		result["baggage"] = copy
	}
	return result
}
