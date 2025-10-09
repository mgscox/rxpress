import ws, { WebSocketServer } from "ws";
import http from 'node:http';
import { EventService } from "./event.service.js";
import { BufferLike } from "../types/index.js";

export namespace WSSService {
  let wss: WebSocketServer | null = null;

  export function createWs(server: http.Server, path = '/') {
    wss = new WebSocketServer({ server, path }); 
    wss.on('listening', () => {
      console.log(`wss is listening`, path)
    })
    wss.on('connection', (ws, req) => {
      EventService.emit({topic: 'wss.connection', data: { ws, req }});
      ws.on('message', (data) => {
        EventService.emit({topic: 'wss.message', data: {ws, data, req}});

        try {
          const json = JSON.parse(Buffer.from(`${data}`).toString());

          if (json.path) {
            EventService.emit({topic: `wss.${json.path}`, data: {ws, data, req}});
          }
        }
        catch { /* Payload was not JSON */ }
      })
      ws.on('close', () => {
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