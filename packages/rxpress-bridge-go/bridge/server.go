package bridge

import (
	"context"
	"fmt"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	pb "github.com/newintel/rxpress-bridge-go/internal/pb/proto"
)

type Handler func(ctx context.Context, method string, input map[string]any, meta map[string]any, bridge *Context) (map[string]any, error)

type server struct {
	pb.UnimplementedInvokerServer

	handlers map[string]Handler
	control  *controlPlane
}

func (s *server) Invoke(ctx context.Context, req *pb.InvokeRequest) (*pb.InvokeResponse, error) {
	resp := &pb.InvokeResponse{
		Correlation: req.GetCorrelation(),
	}

	handler, ok := s.handlers[req.GetHandlerName()]
	if !ok {
		resp.Status = &pb.Status{
			Code:    1,
			Message: fmt.Sprintf("handler not found: %s", req.GetHandlerName()),
		}
		return resp, nil
	}

	meta := fromProtoMeta(req.GetMeta())
	bridgeCtx := newContext(s.control, meta)

	input := make(map[string]any, len(req.GetInput()))
	for key, value := range req.GetInput() {
		decoded, err := decodeValue(value)
		if err != nil {
			resp.Status = &pb.Status{
				Code:    1,
				Message: fmt.Sprintf("decode input %s failed: %v", key, err),
			}
			return resp, nil
		}
		input[key] = decoded
	}

	output, err := handler(ctx, req.GetMethod(), input, meta, bridgeCtx)
	if err != nil {
		resp.Status = &pb.Status{
			Code:    1,
			Message: err.Error(),
		}
		return resp, nil
	}

	result, err := encodeMap(output)
	if err != nil {
		resp.Status = &pb.Status{
			Code:    1,
			Message: fmt.Sprintf("encode handler output failed: %v", err),
		}
		return resp, nil
	}

	resp.Status = &pb.Status{Code: 0}
	resp.Output = result
	return resp, nil
}

type App struct {
	server  *grpc.Server
	control *controlPlane
	conn    *grpc.ClientConn
	errCh   chan error
}

func (a *App) Wait() error {
	if a == nil {
		return nil
	}
	if err, ok := <-a.errCh; ok {
		return err
	}
	return nil
}

func (a *App) Stop() {
	if a == nil {
		return
	}
	a.control.Close()
	a.server.GracefulStop()
	_ = a.conn.Close()
}

type ServeOptions struct {
	ServerOptions []grpc.ServerOption
}

func Serve(ctx context.Context, bind, controlTarget string, handlers map[string]Handler, opts *ServeOptions) (*App, error) {
	if len(handlers) == 0 {
		return nil, fmt.Errorf("serve: at least one handler required")
	}

	lis, err := net.Listen("tcp", bind)
	if err != nil {
		return nil, fmt.Errorf("listen %s: %w", bind, err)
	}

	conn, err := grpc.DialContext(ctx, controlTarget, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial control plane: %w", err)
	}

	control, err := newControlPlane(ctx, conn)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}

	serverOpts := []grpc.ServerOption{}
	if opts != nil && len(opts.ServerOptions) > 0 {
		serverOpts = append(serverOpts, opts.ServerOptions...)
	}

	s := grpc.NewServer(serverOpts...)
	app := &App{
		server:  s,
		control: control,
		conn:    conn,
		errCh:   make(chan error, 1),
	}

	pb.RegisterInvokerServer(s, &server{
		handlers: handlers,
		control:  control,
	})

	go func() {
		defer close(app.errCh)
		if err := s.Serve(lis); err != nil {
			app.errCh <- err
		}
	}()

	return app, nil
}
