package bridge

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "github.com/newintel/rxpress-bridge-go/internal/pb/proto"
)

type ctrlResult struct {
	msg *pb.Control
	err error
}

type controlPlane struct {
	stream pb.ControlPlane_ConnectClient
	cancel context.CancelFunc

	sendMu  sync.Mutex
	pending sync.Map // map[string]chan ctrlResult

	wg sync.WaitGroup
}

func newControlPlane(ctx context.Context, conn *grpc.ClientConn) (*controlPlane, error) {
	stub := pb.NewControlPlaneClient(conn)
	ctx, cancel := context.WithCancel(ctx)
	stream, err := stub.Connect(ctx)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("control connect: %w", err)
	}

	cp := &controlPlane{
		stream: stream,
		cancel: cancel,
	}

	cp.wg.Add(1)
	go cp.recvLoop()
	return cp, nil
}

func (c *controlPlane) recvLoop() {
	defer c.wg.Done()
	for {
		msg, err := c.stream.Recv()
		if err != nil {
			c.failAll(err)
			return
		}
		if msg == nil {
			continue
		}
		if corr := msg.GetCorrelation(); corr != "" {
			if ch, ok := c.pending.LoadAndDelete(corr); ok {
				select {
				case ch.(chan ctrlResult) <- ctrlResult{msg: msg}:
				default:
				}
			}
		}
	}
}

func (c *controlPlane) failAll(err error) {
	c.pending.Range(func(key, value any) bool {
		ch := value.(chan ctrlResult)
		select {
		case ch <- ctrlResult{err: err}:
		default:
		}
		c.pending.Delete(key)
		return true
	})
}

func (c *controlPlane) Close() {
	c.cancel()
	c.wg.Wait()
}

func (c *controlPlane) send(control *pb.Control, expectReply bool, timeout time.Duration) (*pb.Control, error) {
	if control == nil {
		return nil, errors.New("control message is nil")
	}

	corr := control.GetCorrelation()
	if corr == "" {
		corr = uuid.NewString()
		control.Correlation = corr
	}

	var ch chan ctrlResult
	if expectReply {
		ch = make(chan ctrlResult, 1)
		c.pending.Store(corr, ch)
	}

	c.sendMu.Lock()
	err := c.stream.Send(control)
	c.sendMu.Unlock()
	if err != nil {
		if expectReply {
			c.pending.Delete(corr)
		}
		return nil, fmt.Errorf("control send: %w", err)
	}

	if !expectReply {
		return nil, nil
	}

	select {
	case res := <-ch:
		if res.err != nil {
			return nil, res.err
		}
		return res.msg, nil
	case <-time.After(timeout):
		c.pending.Delete(corr)
		return nil, errors.New("control timeout")
	}
}

func (c *controlPlane) log(meta *pb.Meta, level, msg string, fields map[string]*pb.Value) error {
	_, err := c.send(&pb.Control{
		Meta: meta,
		OneofMsg: &pb.Control_Log{
			Log: &pb.LogReq{
				Level:  level,
				Msg:    msg,
				Fields: fields,
			},
		},
	}, false, 0)
	return err
}

func (c *controlPlane) emit(meta *pb.Meta, topic string, data map[string]*pb.Value) error {
	resp, err := c.send(&pb.Control{
		Meta: meta,
		OneofMsg: &pb.Control_Emit{
			Emit: &pb.EmitReq{
				Topic: topic,
				Data:  data,
			},
		},
	}, true, 5*time.Second)
	if err != nil {
		return err
	}

	if resp == nil {
		return errors.New("control emit: empty response")
	}

	switch payload := resp.OneofMsg.(type) {
	case *pb.Control_KvCommonRes:
		if status := payload.KvCommonRes.GetStatus(); status.GetCode() != 0 {
			return statusError(status)
		}
		return nil
	default:
		return fmt.Errorf("control emit: unexpected response %T", payload)
	}
}

func (c *controlPlane) kvGet(bucket, key string) (any, error) {
	resp, err := c.send(&pb.Control{
		OneofMsg: &pb.Control_KvGet{
			KvGet: &pb.KVGetReq{
				Bucket: bucket,
				Key:    key,
			},
		},
	}, true, 5*time.Second)
	if err != nil {
		return nil, err
	}

	res := resp.GetKvGetRes()
	if res == nil {
		return nil, errors.New("kv_get: empty response")
	}
	if st := res.GetStatus(); st.GetCode() != 0 {
		return nil, statusError(st)
	}
	value, err := decodeValue(res.GetValue())
	if err != nil {
		return nil, err
	}
	return value, nil
}

func (c *controlPlane) kvPut(bucket, key string, value any, ttl time.Duration) error {
	encoded, err := encodeValue(value)
	if err != nil {
		return err
	}
	resp, err := c.send(&pb.Control{
		OneofMsg: &pb.Control_KvPut{
			KvPut: &pb.KVPutReq{
				Bucket: bucket,
				Key:    key,
				Value:  encoded,
				TtlSec: int64(ttl.Seconds()),
			},
		},
	}, true, 5*time.Second)
	if err != nil {
		return err
	}

	res := resp.GetKvCommonRes()
	if res == nil {
		return errors.New("kv_put: empty response")
	}
	if st := res.GetStatus(); st.GetCode() != 0 {
		return statusError(st)
	}
	return nil
}

func (c *controlPlane) kvDel(bucket, key string) error {
	resp, err := c.send(&pb.Control{
		OneofMsg: &pb.Control_KvDel{
			KvDel: &pb.KVDelReq{
				Bucket: bucket,
				Key:    key,
			},
		},
	}, true, 5*time.Second)
	if err != nil {
		return err
	}

	res := resp.GetKvCommonRes()
	if res == nil {
		return errors.New("kv_del: empty response")
	}
	if st := res.GetStatus(); st.GetCode() != 0 {
		return statusError(st)
	}
	return nil
}

func statusError(st *pb.Status) error {
	if st == nil {
		return errors.New("status nil")
	}
	return status.Error(int32ToCode(st.GetCode()), st.GetMessage())
}

func int32ToCode(code int32) codes.Code {
	if code == 0 {
		return codes.OK
	}
	return codes.Code(code)
}
