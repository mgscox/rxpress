import ws, { WebSocketServer } from "ws";
import http from 'node:http';
import { EventService } from "./event.service.js";
import { BufferLike } from "../types/index.js";

export namespace WSSService {
  let wss: WebSocketServer | null = null;

  export function createWs(server: http.Server, path = '/') {
    wss = new WebSocketServer({ server, path }); 
    wss.on('listening', () => {
      EventService.emit({topic: 'wss.start', data: {}});
    })
    wss.on('connection', (ws, req) => {
      EventService.emit({topic: 'wss.connection', data: { ws, req }});
      const pingInterval = setInterval(
        () => ws.ping(), 
        30_000
      );
      ws.on('message', (data) => {
        if (`${data}` === 'ping') {
          ws.pong();
          return;
        }
        
        try {
          EventService.emit({topic: 'wss.message', data: {ws, data, req}});
          const json = JSON.parse(Buffer.from(`${data}`).toString());

          if (json.path) {
            EventService.emit({topic: `wss.${json.path}`, data: {ws, data, req}});
          }
        }
        catch { /* Payload was not JSON */ }
      })
      ws.on('close', () => {
        clearInterval(pingInterval);
        EventService.emit({topic: 'wss.close', data: {}});
      })
    });        
  }

  export function broadcast(data: BufferLike, exclude: ws[] = []) {
    wss?.clients.forEach(client => {
      if (client.readyState === ws.OPEN && !exclude.includes(client)) {
        client.send(data);
      }
    });
  }

  export function close() {
    wss?.close();
  }

}