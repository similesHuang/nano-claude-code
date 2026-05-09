import * as http from 'http';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';

function uuidv4(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

type SessionType = 'ws' | 'ext_ws' | 'http';

interface SessionInfo {
  url?: string;
  title?: string;
  type?: SessionType;
  connected_at?: number;
}

interface PendingResult {
  success: boolean;
  data: any;
  newTabs: any[];
}

class Session {
  id: string;
  info: SessionInfo;
  connectAt: number;
  disconnectAt: number | null = null;
  type: SessionType;
  wsClient: WebSocket | null = null;
  /** resolve 函数队列，用于 http long-poll 模式 */
  httpResolvers: Array<(msg: string) => void> = [];

  constructor(id: string, info: SessionInfo, client?: WebSocket | 'http') {
    this.id = id;
    this.info = info;
    this.connectAt = Date.now() / 1000;
    this.type = (info.type ?? 'ws') as SessionType;
    if (this.type === 'http') {
      // http 模式不需要 wsClient
    } else if (client instanceof WebSocket) {
      this.wsClient = client;
    }
  }

  get url(): string {
    return this.info.url ?? '';
  }

  isActive(): boolean {
    if (this.type === 'http' && Date.now() / 1000 - this.connectAt > 60) {
      this.markDisconnected();
    }
    return this.disconnectAt === null;
  }

  reconnect(client: WebSocket | 'http', info: SessionInfo): void {
    this.info = info;
    this.type = (info.type ?? 'ws') as SessionType;
    if (this.type === 'http') {
      this.wsClient = null;
    } else if (client instanceof WebSocket) {
      this.wsClient = client;
      this.httpResolvers = [];
    }
    this.connectAt = Date.now() / 1000;
    this.disconnectAt = null;
  }

  markDisconnected(): void {
    if (this.isActiveRaw()) {
      process.stderr.write(`Tab disconnected: ${this.url} (Session: ${this.id})\n`);
    }
    this.disconnectAt = Date.now() / 1000;
    // 释放所有等待的 long-poll
    for (const resolve of this.httpResolvers) {
      resolve(JSON.stringify({ id: '', ret: 'disconnected' }));
    }
    this.httpResolvers = [];
  }

  /** 不检查 http 超时的原始活跃判断 */
  private isActiveRaw(): boolean {
    return this.disconnectAt === null;
  }

  /** 推送消息给 http long-poll 客户端（如有等待的 resolve，立即响应） */
  pushHttpMessage(msg: string): void {
    const resolve = this.httpResolvers.shift();
    if (resolve) {
      resolve(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// TMWebDriver
// ---------------------------------------------------------------------------

export class TMWebDriver {
  host: string;
  port: number;
  sessions: Map<string, Session> = new Map();
  results: Map<string, PendingResult> = new Map();
  acks: Map<string, boolean> = new Map();
  defaultSessionId: string | null = null;
  latestSessionId: string | null = null;

  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;

  constructor(host = '127.0.0.1', port = 18765) {
    this.host = host;
    this.port = port;
    this.startWsServer();
    this.startHttpServer();
  }

  // -------------------------------------------------------------------------
  // WebSocket 服务器
  // -------------------------------------------------------------------------

  private startWsServer(): void {
    this.wss = new WebSocketServer({ host: this.host, port: this.port });

    this.wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (raw: Buffer | string) => {
        try {
          const data = JSON.parse(raw.toString());
          const type: string = data.type ?? '';

          if (type === 'ready') {
            const sessionInfo: SessionInfo = {
              url: data.url,
              title: data.title ?? '',
              connected_at: Date.now() / 1000,
              type: 'ws',
            };
            this.registerClient(data.sessionId, ws, sessionInfo);

          } else if (type === 'ext_ready' || type === 'tabs_update') {
            const tabs: any[] = data.tabs ?? [];
            const currentTabIds = new Set(tabs.map((t: any) => String(t.id)));
            for (const [sid, sess] of this.sessions) {
              if (sess.type === 'ext_ws' && !currentTabIds.has(sid)) {
                sess.markDisconnected();
              }
            }
            for (const tab of tabs) {
              const sessionId = String(tab.id);
              const sessionInfo: SessionInfo = {
                url: tab.url,
                title: tab.title ?? '',
                connected_at: Date.now() / 1000,
                type: 'ext_ws',
              };
              const existing = this.sessions.get(sessionId);
              if (existing && existing.isActive()) {
                existing.info = sessionInfo;
              } else {
                this.registerClient(sessionId, ws, sessionInfo);
              }
            }

          } else if (type === 'ack') {
            this.acks.set(data.id ?? '', true);

          } else if (type === 'result') {
            this.results.set(data.id, {
              success: true,
              data: data.result,
              newTabs: data.newTabs ?? [],
            });

          } else if (type === 'error') {
            this.results.set(data.id, {
              success: false,
              data: data.error,
              newTabs: data.newTabs ?? [],
            });
          }
        } catch (e) {
          console.error('Error handling WS message:', e);
        }
      });

      ws.on('close', () => {
        this.unregisterClient(ws);
      });
    });

    process.stderr.write(`WebSocket server running on ws://${this.host}:${this.port}\n`);
  }

  // -------------------------------------------------------------------------
  // HTTP 服务器（long-poll + result 上报）
  // -------------------------------------------------------------------------

  private startHttpServer(): void {
    this.httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const pathname = url.pathname;

      const readBody = (): Promise<any> =>
        new Promise((resolve) => {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve({});
            }
          });
        });

      const sendJson = (obj: any) => {
        const str = JSON.stringify(obj, null, 0);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(str);
      };

      try {
        if (pathname === '/api/longpoll' && req.method === 'POST') {
          const data = await readBody();
          const sessionId: string = data.sessionId;
          const sessionInfo: SessionInfo = { url: data.url, title: data.title ?? '', type: 'http' };

          if (!this.sessions.has(sessionId)) {
            const sess = new Session(sessionId, sessionInfo, 'http');
            process.stderr.write(`Browser http connected: ${sess.url} (Session: ${sessionId})\n`);
            this.sessions.set(sessionId, sess);
          }
          const sess = this.sessions.get(sessionId)!;
          if (sess.disconnectAt !== null && sess.type !== 'http') {
            sess.reconnect('http', sessionInfo);
          }
          sess.disconnectAt = null;
          sess.connectAt = Date.now() / 1000;

          if (sess.type !== 'http') {
            sendJson({ id: '', ret: 'use ws' });
            return;
          }

          // long-poll: 等待最多 5 秒
          const msg = await new Promise<string>((resolve) => {
            sess.httpResolvers.push(resolve);
            setTimeout(() => {
              const idx = sess.httpResolvers.indexOf(resolve);
              if (idx !== -1) sess.httpResolvers.splice(idx, 1);
              resolve(JSON.stringify({ id: '', ret: 'next long-poll' }));
            }, 5000);
          });

          // 处理 ack
          try {
            const parsed = JSON.parse(msg);
            if (parsed.id) this.acks.set(parsed.id, true);
          } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(msg);
          return;
        }

        if (pathname === '/api/result' && req.method === 'POST') {
          const data = await readBody();
          if (data.type === 'result') {
            this.results.set(data.id, { success: true, data: data.result, newTabs: data.newTabs ?? [] });
          } else if (data.type === 'error') {
            this.results.set(data.id, { success: false, data: data.error, newTabs: data.newTabs ?? [] });
          }
          res.writeHead(200);
          res.end('ok');
          return;
        }

        if (pathname === '/link' && req.method === 'POST') {
          const data = await readBody();
          if (data.cmd === 'get_all_sessions') {
            sendJson({ r: this.getAllSessions() });
          } else if (data.cmd === 'find_session') {
            sendJson({ r: this.findSession(data.url_pattern ?? '') });
          } else if (data.cmd === 'execute_js') {
            try {
              const result = await this.executeJs(data.code, {
                timeout: parseFloat(data.timeout ?? '10'),
                sessionId: data.sessionId,
              });
              sendJson({ r: result });
            } catch (e: any) {
              sendJson({ r: { error: e.message } });
            }
          } else {
            res.writeHead(200);
            res.end('ok');
          }
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      } catch (e) {
        console.error('HTTP handler error:', e);
        res.writeHead(500);
        res.end('Internal error');
      }
    });

    this.httpServer.listen(this.port + 1, this.host, () => {
      process.stderr.write(`HTTP server running on http://${this.host}:${this.port + 1}\n`);
    });
  }

  // -------------------------------------------------------------------------
  // 会话注册 / 注销
  // -------------------------------------------------------------------------

  private registerClient(sessionId: string, client: WebSocket, info: SessionInfo): void {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      const sess = new Session(sessionId, info, client);
      this.sessions.set(sessionId, sess);
      // process.stderr.write(`New tab connected: ${sess.url} (Session: ${sessionId})\n`);
    } else {
      existing.reconnect(client, info);
      // process.stderr.write(`Tab reconnected: ${existing.url} (Session: ${sessionId})\n`);
    }
    this.latestSessionId = sessionId;
    if (this.defaultSessionId === null) this.defaultSessionId = sessionId;
  }

  private unregisterClient(client: WebSocket): void {
    for (const sess of this.sessions.values()) {
      if (sess.wsClient === client) sess.markDisconnected();
    }
  }

  // -------------------------------------------------------------------------
  // 清理过期会话
  // -------------------------------------------------------------------------

  cleanSessions(): void {
    for (const [sid, sess] of this.sessions) {
      if (!sess.isActive() && Date.now() / 1000 - (sess.disconnectAt ?? 0) > 600) {
        this.sessions.delete(sid);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 核心：执行 JS
  // -------------------------------------------------------------------------

  async executeJs(
    code: string,
    options: { timeout?: number; sessionId?: string | null } = {},
  ): Promise<any> {
    const timeout = options.timeout ?? 15;
    let sessionId = options.sessionId ?? this.defaultSessionId;

    let sess = sessionId ? this.sessions.get(sessionId) : undefined;

    if (!sess || !sess.isActive()) {
      // 等 3s 重试
      await delay(3000);
      sess = sessionId ? this.sessions.get(sessionId) : undefined;
      if (!sess || !sess.isActive()) {
        const alive = [...this.sessions.values()].filter((s) => s.isActive());
        if (alive.length > 0) {
          sess = alive[0];
          process.stderr.write(`会话 ${sessionId} 未连接，自动切换到: ${sess.id}\n`);
          sessionId = this.defaultSessionId = sess.id;
        } else {
          throw new Error(`会话ID ${sessionId} 未连接`);
        }
      }
    }

    const tp = sess.type;
    const execId = uuidv4();
    const payloadObj: any = { id: execId, code };
    if (tp === 'ext_ws') payloadObj.tabId = parseInt(sess.id, 10);
    const payload = JSON.stringify(payloadObj);

    if (tp === 'ws' || tp === 'ext_ws') {
      sess.wsClient!.send(payload);
    } else if (tp === 'http') {
      sess.pushHttpMessage(payload);
    }

    this.cleanSessions();

    const startTime = Date.now();
    let acked = false;
    let hasjump = false;

    while (!this.results.has(execId)) {
      await delay(200);

      if (!acked && this.acks.has(execId)) {
        acked = true;
        // 重置超时起点
        (startTime as any); // ts workaround — use separate var
      }

      if (tp === 'ws' || tp === 'ext_ws') {
        if (!sess.isActive()) hasjump = true;
        if (hasjump && sess.isActive()) {
          return { result: `Session ${sessionId} reloaded.`, closed: 1 };
        }
      }

      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > timeout) {
        if (tp === 'ws' || tp === 'ext_ws') {
          if (hasjump) return { result: `Session ${sessionId} reloaded and new page is loading...`, closed: 1 };
          if (acked) return { result: `No response data in ${timeout}s (ACK received, script may still be running)` };
          return { result: `No response data in ${timeout}s (no ACK, script may not have been delivered)` };
        } else {
          if (acked) return { result: `Session ${sessionId} no response in ${timeout}s (delivered but no result)` };
          return { result: `Session ${sessionId} no response in ${timeout}s (script not polled)` };
        }
      }
    }

    const result = this.results.get(execId)!;
    this.results.delete(execId);
    this.acks.delete(execId);

    if (!result.success) throw new Error(result.data);

    const rr: any = { data: result.data };
    const newTabs = result.newTabs.map((t: any) => { const c = { ...t }; delete c.ts; return c; });
    if (newTabs.length > 0) rr.newTabs = newTabs;
    return rr;
  }

  // -------------------------------------------------------------------------
  // 会话查询 / 操作
  // -------------------------------------------------------------------------

  getAllSessions(): any[] {
    return [...this.sessions.values()]
      .filter((s) => s.isActive())
      .map((s) => ({ id: s.id, ...s.info }));
  }

  getSessionDict(): Record<string, string> {
    return Object.fromEntries(this.getAllSessions().map((s) => [s.id, s.url ?? '']));
  }

  findSession(urlPattern: string): Array<[string, SessionInfo]> {
    if (urlPattern === '') {
      const sess = this.latestSessionId ? this.sessions.get(this.latestSessionId) : undefined;
      return sess ? [[sess.id, sess.info]] : [];
    }
    const result: Array<[string, SessionInfo]> = [];
    for (const sess of this.sessions.values()) {
      if (!sess.isActive()) continue;
      if (sess.info.url?.includes(urlPattern)) {
        result.push([sess.id, sess.info]);
      }
    }
    return result;
  }

  setSession(urlPattern: string): string | undefined {
    const matched = this.findSession(urlPattern);
    if (!matched.length) {
      console.warn(`警告: 未找到URL包含 '${urlPattern}' 的会话`);
      return;
    }
    if (matched.length > 1) {
      console.warn(`警告: 找到多个URL包含 '${urlPattern}' 的会话，选择第一个`);
    }
    const [id] = matched[0];
    this.defaultSessionId = id;
    process.stderr.write(`成功设置默认会话: ${id}: ${matched[0][1].url}\n`);
    return id;
  }

  async jump(url: string, timeout = 10): Promise<any> {
    return this.executeJs(`window.location.href='${url}'`, { timeout });
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
