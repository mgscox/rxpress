package bridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"

	pb "github.com/newintel/rxpress-bridge-go/internal/pb/proto"
)

// encodeValue mirrors the behaviour of the rxpress value codec used in other bridges.
func encodeValue(value any) (*pb.Value, error) {
	msg := &pb.Value{}

	switch v := value.(type) {
	case nil:
		msg.V = &pb.Value_Json{Json: "null"}
	case string:
		msg.V = &pb.Value_S{S: v}
	case []byte:
		msg.V = &pb.Value_Bin{Bin: v}
	case bool:
		msg.V = &pb.Value_B{B: v}
	case json.RawMessage:
		msg.V = &pb.Value_Json{Json: string(v)}
	case fmt.Stringer:
		msg.V = &pb.Value_S{S: v.String()}
	default:
		switch reflect.TypeOf(value).Kind() {
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
			msg.V = &pb.Value_I64{I64: reflect.ValueOf(value).Int()}
		case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
			u := reflect.ValueOf(value).Uint()
			if u > math.MaxInt64 {
				return nil, fmt.Errorf("encodeValue: uint64 %d overflows int64", u)
			}
			msg.V = &pb.Value_I64{I64: int64(u)}
		case reflect.Float32, reflect.Float64:
			msg.V = &pb.Value_F64{F64: reflect.ValueOf(value).Convert(reflect.TypeOf(float64(0))).Float()}
		case reflect.Slice:
			// Handle []byte style slices already covered; fallthrough to JSON.
			fallthrough
		case reflect.Map, reflect.Array, reflect.Struct:
			payload, err := json.Marshal(value)
			if err != nil {
				return nil, fmt.Errorf("encodeValue: json marshal: %w", err)
			}
			msg.V = &pb.Value_Json{Json: string(payload)}
		default:
			payload, err := json.Marshal(value)
			if err != nil {
				// Best-effort stringification.
				msg.V = &pb.Value_S{S: fmt.Sprint(value)}
			} else {
				msg.V = &pb.Value_Json{Json: string(payload)}
			}
		}
	}

	return msg, nil
}

func decodeValue(message *pb.Value) (any, error) {
	if message == nil {
		return nil, nil
	}

	switch v := message.V.(type) {
	case *pb.Value_S:
		return v.S, nil
	case *pb.Value_I64:
		return v.I64, nil
	case *pb.Value_F64:
		return v.F64, nil
	case *pb.Value_B:
		return v.B, nil
	case *pb.Value_Bin:
		return append([]byte(nil), v.Bin...), nil
	case *pb.Value_Json:
		if v.Json == "" {
			return "", nil
		}
		var decoded any
		if err := json.Unmarshal([]byte(v.Json), &decoded); err != nil {
			// Surface the raw JSON string if it cannot be parsed.
			return v.Json, nil
		}
		return decoded, nil
	default:
		return nil, errors.New("unknown value type")
	}
}
