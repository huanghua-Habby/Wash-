/** HTTP/static + signaling entry. The service registers rooms and relays WebRTC negotiation; gameplay runs in host browsers. */
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:dgram';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { Rooms, RoomError, type Member } from './Rooms.js';
import { startStun } from './stun.js';
import { REGISTRY_VERSION } from '../../shared/protocol.js';

/** ICE servers advertised to browsers: optional operator-provided list, plus this PC's own STUN responder when enabled.
 *  The STUN address is the host name the browser used to reach this service, so LAN and static pages agree. */
export function iceServersFor(request: IncomingMessage | undefined, stunPort: number, configured = process.env.WASH_ICE_SERVERS) {
  const servers: object[] = [];
  if (configured) { const list = JSON.parse(configured); if (!Array.isArray(list)) throw new Error('WASH_ICE_SERVERS must be a JSON array'); servers.push(...list); }
  const hostname = request?.headers.host ? new URL(`http://${request.headers.host}`).hostname : '';
  if (stunPort > 0 && hostname) servers.push({ urls: `stun:${hostname.includes(':') ? `[${hostname}]` : hostname}:${stunPort}` });
  return servers;
}

/** Build a server without listening, also used by real WebSocket integration tests. */
export async function createServer(options: { clientRoot?: string; basePath?: string; maxRooms?: number; stunPort?: number } = {}) {
  const app = Fastify({ logger:true });
  const stunPort = options.stunPort ?? 0;
  iceServersFor(undefined,stunPort);
  const rooms = new Rooms(options.maxRooms,(request) => iceServersFor(request as IncomingMessage,stunPort));
  const stun: Socket | null = stunPort > 0 ? await startStun(stunPort) : null;
  const basePath = (options.basePath ?? process.env.BASE_PATH ?? '').replace(/\/+$/,'');
  if (basePath && !/^\/mp\/[a-z0-9-]+$/.test(basePath)) throw new Error('BASE_PATH must be /mp/{server-name}');
  const repository = resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  const buildRoot = resolve(repository,'dist/client');
  const clientRoot = options.clientRoot || buildRoot;
  if (!existsSync(resolve(clientRoot,'index.html'))) throw new Error('Client build is missing. Run npm run dev or npm run build before starting the server.');
  const setHeaders = (response: import('fastify').FastifyReply, path: string) => { if (path.endsWith('index.html')) response.header('Cache-Control','no-store'); };
  await app.register(staticFiles,{ root:clientRoot,prefix:'/',index:['index.html'],setHeaders });
  if (basePath) await app.register(staticFiles,{ root:clientRoot,prefix:`${basePath}/`,decorateReply:false,setHeaders });
  app.get('/favicon.ico',async (_request,reply) => reply.code(204).send());
  for (const prefix of basePath ? ['',basePath] : ['']) app.get(`${prefix}/health`,async () => ({ ok:true,service:'wash-room-server',registry:REGISTRY_VERSION,rooms:rooms.rooms.size }));
  // SDP offers with several candidates exceed 4 KiB.
  const wss = new WebSocketServer({ noServer:true,maxPayload:32_768 });
  let closing = false;
  app.server.on('upgrade',(req,socket,head) => {
    if (closing) { socket.destroy(); return; }
    const path = req.url?.split('?')[0];
    if (path !== '/ws' && path !== `${basePath}/ws`) { socket.destroy(); return; }
    if (wss.clients.size >= 1024) { socket.destroy(); return; }
    wss.handleUpgrade(req,socket,head,(ws) => wss.emit('connection',ws,req));
  });
  wss.on('connection',(ws: WebSocket,request: IncomingMessage) => {
    let member: Member | undefined;
    let packets = 0, windowStart = Date.now();
    let alive = true;
    const timer = setTimeout(() => { if (!member) ws.close(4002,'hello_required'); },5000);
    const heartbeat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; ws.ping(); },10_000);
    ws.on('pong',() => { alive = true; });
    ws.on('message',(raw) => {
      if (Date.now()-windowStart > 1000) { windowStart=Date.now(); packets=0; }
      if (++packets > 180) { ws.close(4008,'rate_limit'); return; }
      let requestId: string | undefined;
      try {
        const frame = JSON.parse(raw.toString());
        if (frame?.type === 'customize' && typeof frame.requestId === 'string' && frame.requestId.length <= 64) requestId = frame.requestId;
        if (!frame || frame.v !== REGISTRY_VERSION || typeof frame.type !== 'string') throw new RoomError('protocol_mismatch','房间服务版本不一致，请刷新页面');
        if (!member) {
          if (frame.type !== 'hello') throw new RoomError('hello_required','连接尚未完成');
          member = rooms.connect(ws,frame.name,typeof frame.token === 'string' ? frame.token : undefined,request,frame.appearance); clearTimeout(timer); return;
        }
        switch (frame.type) {
          case 'join': rooms.join(member,frame.code); break;
          case 'leave': rooms.leave(member); break;
          case 'rename': rooms.rename(member,frame.name); break;
          case 'customize':
            if (!requestId) throw new RoomError('bad_request','定制请求无效');
            rooms.customize(member,frame.appearance,requestId); break;
          case 'host_phase': rooms.hostPhase(member,frame.phase); break;
          case 'set_mode': rooms.setMode(member,frame.mode); break;
          case 'set_team': rooms.setTeam(member,frame.team); break;
          case 'set_settings': rooms.setSettings(member,frame.settings); break;
          case 'set_ready': rooms.setReady(member,frame.ready); break;
          case 'signal': rooms.signal(member,frame.to,frame.data); break;
          case 'turn_away': rooms.turnAway(member,frame.member); break;
          case 'release_guest': rooms.releaseGuest(member,frame.member,frame.reason); break;
          case 'reconnect': rooms.reconnect(member); break;
          default: throw new RoomError('bad_request','未知操作');
        }
      } catch (error) {
        if (error instanceof RoomError) ws.send(JSON.stringify({ v:REGISTRY_VERSION,type:'error',code:error.code,message:error.message,...(requestId ? {requestId} : {}) }));
        else if (error instanceof SyntaxError) ws.close(4002,'bad_json');
        else { app.log.error(error); ws.close(1011,'internal'); }
      }
    });
    ws.on('error',(error) => app.log.warn(error));
    ws.on('close',() => { clearTimeout(timer); clearInterval(heartbeat); if (member) rooms.disconnect(member,ws); });
  });
  const sweep = setInterval(() => rooms.sweep(),1000);
  // HTTP close waits for upgraded sockets, so onClose is too late to terminate them.
  // Stop upgrades and drain WebSockets first; otherwise SIGTERM leaves a non-listening process holding old rooms/STUN.
  app.addHook('preClose',async () => {
    closing = true;
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((done,fail) => wss.close(error => error ? fail(error) : done()));
  });
  app.addHook('onClose',async () => {
    clearInterval(sweep); stun?.close();
    rooms.close();
  });
  return { app,rooms };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || process.env.APP_PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const { app } = await createServer({ stunPort:Number(process.env.WASH_STUN_PORT ?? 3478) });
  await app.listen({ port,host:process.env.HOST || '127.0.0.1' });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => {
    app.log.info({signal},'Stopping room service');
    void app.close().then(() => process.exit(0));
  });
}
