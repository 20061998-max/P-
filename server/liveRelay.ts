import http from 'node:http';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { verifyFirebaseAdminToken } from './firebaseAuth.ts';
import { verifyJwt } from './jwt.ts';
import { verifyOfflineActivationKey } from './license.ts';
import { canAcceptWsConnection, releaseWsConnection } from './security.ts';
import { findProfileById } from './store.ts';

export interface LiveBroadcastState {
  isLive: boolean;
  title: string;
  sourceApp: string;
  hasAudio: boolean;
  sampleRate: number;
  startedAt: string | null;
  viewerCount: number;
}

interface AuthedSocket extends WebSocket {
  role?: 'broadcaster' | 'viewer';
  isAlive?: boolean;
  deviceCode?: string;
  remoteIp?: string;
}

const FRAME_VIDEO = 0x01;
const FRAME_AUDIO = 0x02;
const MAX_VIDEO_FRAME_BYTES = 1_500_000;
const MAX_AUDIO_FRAME_BYTES = 262_144;

let broadcasterSocket: AuthedSocket | null = null;
const viewers = new Set<AuthedSocket>();
let lastVideoFrame: Buffer | null = null;

const state: LiveBroadcastState = {
  isLive: false,
  title: 'Transmissão Ao Vivo · Jogos do Mengão',
  sourceApp: 'App selecionado',
  hasAudio: false,
  sampleRate: 24000,
  startedAt: null,
  viewerCount: 0,
};

export function getLiveBroadcastStatus(): LiveBroadcastState {
  return {
    ...state,
    viewerCount: viewers.size,
  };
}

function safeSendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastState() {
  const snapshot = getLiveBroadcastStatus();
  const msg = JSON.stringify({ type: 'live:state', state: snapshot });
  if (broadcasterSocket && broadcasterSocket.readyState === WebSocket.OPEN) {
    broadcasterSocket.send(msg);
  }
  for (const viewer of viewers) {
    if (viewer.readyState === WebSocket.OPEN) {
      viewer.send(msg);
    }
  }
}

function stopBroadcast() {
  state.isLive = false;
  state.hasAudio = false;
  state.startedAt = null;
  lastVideoFrame = null;
  broadcastState();
}

let activeWss: WebSocketServer | null = null;

export function broadcastAppUpdate(payload: {
  kind: 'config' | 'app';
  configVersion: number;
  buildId?: string;
}): void {
  if (!activeWss) return;
  const msg = JSON.stringify({ type: 'app:update', ...payload });
  for (const client of activeWss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

export function forceStopLiveBroadcast(): void {
  if (broadcasterSocket) {
    try {
      safeSendJson(broadcasterSocket, {
        type: 'broadcast:superseded',
        erro: 'Transmissão encerrada pelo Painel Admin.',
      });
      broadcasterSocket.role = undefined;
      broadcasterSocket.close(1000, 'Stopped by admin');
    } catch {
      // ignore
    }
    broadcasterSocket = null;
  }
  stopBroadcast();
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

export function attachLiveRelay(server: http.Server): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2 * 1024 * 1024,
  });
  activeWss = wss;

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url || '/', 'http://localhost');
    if (reqUrl.pathname !== '/ws/live') {
      return;
    }

    if (!canAcceptWsConnection(request.socket.remoteAddress, reqUrl.pathname)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      (ws as AuthedSocket).remoteIp = request.socket.remoteAddress;
      wss.emit('connection', ws, request);
    });
  });

  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      const s = client as AuthedSocket;
      if (s.isAlive === false) {
        s.terminate();
        continue;
      }
      s.isAlive = false;
      s.ping();
    }
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (rawWs: WebSocket) => {
    const ws = rawWs as AuthedSocket;
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    safeSendJson(ws, { type: 'live:state', state: getLiveBroadcastStatus() });

    ws.on('message', async (data, isBinary) => {
      if (isBinary) {
        if (ws.role !== 'broadcaster' || ws !== broadcasterSocket || !state.isLive) {
          return;
        }
        const buf = rawDataToBuffer(data);
        if (buf.length < 2) return;
        const kind = buf[0];
        if (kind === FRAME_VIDEO) {
          if (buf.length > MAX_VIDEO_FRAME_BYTES) return;
          lastVideoFrame = buf;
          for (const viewer of viewers) {
            if (viewer.readyState === WebSocket.OPEN && viewer.bufferedAmount < 768 * 1024) {
              viewer.send(buf, { binary: true });
            }
          }
        } else if (kind === FRAME_AUDIO) {
          if (buf.length > MAX_AUDIO_FRAME_BYTES) return;
          for (const viewer of viewers) {
            if (viewer.readyState === WebSocket.OPEN && viewer.bufferedAmount < 256 * 1024) {
              viewer.send(buf, { binary: true });
            }
          }
        }
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawDataToBuffer(data).toString('utf-8')) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'auth:broadcaster') {
        const idToken = String(msg.idToken || '').trim();
        const localAdmin = verifyJwt(idToken);
        const firebaseAdmin = localAdmin?.role === 'admin' ? null : await verifyFirebaseAdminToken(idToken);
        if (localAdmin?.role !== 'admin' && !firebaseAdmin) {
          safeSendJson(ws, {
            type: 'auth:error',
            erro: 'Apenas o administrador autorizado (Google ou Senha Admin) pode transmitir ao vivo.',
          });
          ws.close(4003, 'Unauthorized broadcaster');
          return;
        }

        if (broadcasterSocket && broadcasterSocket !== ws) {
          safeSendJson(broadcasterSocket, {
            type: 'broadcast:superseded',
            erro: 'Outra sessão administrativa assumiu a transmissão.',
          });
          broadcasterSocket.role = undefined;
          broadcasterSocket.close(4001, 'Superseded');
        }

        broadcasterSocket = ws;
        ws.role = 'broadcaster';
        state.isLive = true;
        state.title = String(msg.title || 'Transmissão Ao Vivo · Jogos do Mengão').trim().slice(0, 120);
        state.sourceApp = String(msg.sourceApp || 'App selecionado').trim().slice(0, 80);
        state.hasAudio = Boolean(msg.hasAudio);
        state.sampleRate = Math.max(8000, Math.min(48000, Math.floor(Number(msg.sampleRate) || 24000)));
        state.startedAt = new Date().toISOString();
        lastVideoFrame = null;

        safeSendJson(ws, { type: 'auth:ok', role: 'broadcaster', state: getLiveBroadcastStatus() });
        broadcastState();
        return;
      }

      if (type === 'broadcast:meta') {
        if (ws.role !== 'broadcaster' || ws !== broadcasterSocket) return;
        if (typeof msg.title === 'string' && msg.title.trim()) {
          state.title = msg.title.trim().slice(0, 120);
        }
        if (typeof msg.sourceApp === 'string' && msg.sourceApp.trim()) {
          state.sourceApp = msg.sourceApp.trim().slice(0, 80);
        }
        if (typeof msg.hasAudio === 'boolean') {
          state.hasAudio = msg.hasAudio;
        }
        if (typeof msg.sampleRate === 'number') {
          state.sampleRate = Math.max(8000, Math.min(48000, Math.floor(msg.sampleRate)));
        }
        broadcastState();
        return;
      }

      if (type === 'broadcast:stop') {
        if (ws.role !== 'broadcaster' || ws !== broadcasterSocket) return;
        stopBroadcast();
        return;
      }

      if (type === 'auth:viewer') {
        const adminToken = typeof msg.adminToken === 'string' ? msg.adminToken.trim() : '';
        const authToken = typeof msg.authToken === 'string' ? msg.authToken.trim() : '';
        let authorized = false;

        if (adminToken) {
          const localAdmin = verifyJwt(adminToken);
          if (localAdmin?.role === 'admin') {
            authorized = true;
          } else {
            const admin = await verifyFirebaseAdminToken(adminToken);
            if (admin) authorized = true;
          }
        }

        if (!authorized && authToken) {
          const subscriberJwt = verifyJwt(authToken);
          if (subscriberJwt) {
            if (subscriberJwt.role === 'admin') {
              authorized = true;
            } else {
              const profile = findProfileById(subscriberJwt.sub);
              if (
                profile &&
                profile.status_assinatura === 'ativo' &&
                profile.expira_em &&
                new Date(profile.expira_em).getTime() > Date.now()
              ) {
                authorized = true;
              }
            }
          }
        }

        if (!authorized) {
          const deviceCode = String(msg.deviceCode || '').trim();
          const activationKey = String(msg.activationKey || '').trim();
          const verified = verifyOfflineActivationKey(deviceCode, activationKey);
          if (!verified.ativo) {
            safeSendJson(ws, {
              type: 'auth:error',
              erro: verified.motivo || 'Ative sua assinatura offline para assistir ao vivo.',
            });
            ws.close(4003, 'Unauthorized viewer');
            return;
          }
          ws.deviceCode = deviceCode;
        }

        ws.role = 'viewer';
        viewers.add(ws);
        safeSendJson(ws, { type: 'auth:ok', role: 'viewer', state: getLiveBroadcastStatus() });
        if (state.isLive && lastVideoFrame && ws.readyState === WebSocket.OPEN) {
          ws.send(lastVideoFrame, { binary: true });
        }
        broadcastState();
      }
    });

    ws.on('close', () => {
      releaseWsConnection(ws.remoteIp);
      if (ws.role === 'broadcaster' && ws === broadcasterSocket) {
        broadcasterSocket = null;
        stopBroadcast();
      } else if (viewers.delete(ws)) {
        broadcastState();
      }
    });
  });
}
