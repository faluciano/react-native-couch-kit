/**
 * In-memory stand-ins for the native modules the host imports.
 *
 * `react-native-nitro-http-server`, `expo-file-system`, `expo-network` and
 * `react-native` need a device, so this module replaces them with small fakes
 * via `mock.module`. Mocks are process-global in Bun, which is why every test
 * file that needs them imports this one module instead of declaring its own:
 * it is evaluated once, so all files share the same fakes and the same state.
 *
 * Import it before the source under test, and load that source with a dynamic
 * `await import(...)` so the mocks are in place when it resolves its imports.
 * Call {@link resetNativeFakes} in `beforeEach` to start from a clean slate.
 */
import { mock } from "bun:test";

// ─── nitro-http-server: WebSocket ────────────────────────────────────────────

/** A server-side socket the test drives: receive frames, close, error. */
export class FakeServerWebSocket {
  /** Raw frames the server sent, in order. */
  readonly sent: string[] = [];
  readonly closeCalls: { code?: number; reason?: string }[] = [];
  /** When set, `send()` rejects with it (asynchronously, like the real one). */
  sendError: Error | null = null;
  /** When set, `close()` rejects with it. */
  closeError: Error | null = null;

  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose:
    | ((event: { code: number; reason: string; wasClean: boolean }) => void)
    | null = null;
  onerror: ((event: { message: string }) => void) | null = null;

  async send(data: string): Promise<void> {
    if (this.sendError) throw this.sendError;
    this.sent.push(data);
  }

  async close(code?: number, reason?: string): Promise<void> {
    this.closeCalls.push({ code, reason });
    if (this.closeError) throw this.closeError;
  }

  /** Delivers an inbound frame from the phone. */
  receive(data: string | ArrayBuffer): void {
    this.onmessage?.({ data });
  }

  /** Delivers an inbound frame holding `message` serialized as JSON. */
  receiveJson(message: unknown): void {
    this.receive(JSON.stringify(message));
  }

  /** The phone hangs up. */
  disconnect(code = 1000, reason = ""): void {
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }

  /** The socket reports a transport error. */
  fail(message: string): void {
    this.onerror?.({ message });
  }

  /** Sent frames, parsed. */
  messages(): { type: string; payload?: unknown }[] {
    return this.sent.map((frame) => JSON.parse(frame));
  }

  messageTypes(): string[] {
    return this.messages().map((message) => message.type);
  }
}

type WebSocketHandler = (
  ws: FakeServerWebSocket,
  request: { path: string; query: string; headers: Record<string, string> },
) => void;

export class FakeConfigServer {
  static instances: FakeConfigServer[] = [];
  /** When set, the next `start()` rejects with it (then it is cleared). */
  static nextStartError: unknown = null;

  readonly wsHandlers = new Map<string, WebSocketHandler>();
  startArgs: {
    port: number;
    handler: () => Promise<{ statusCode: number; body: string }>;
    config: { mounts: { type: string; path: string }[] };
    host?: string;
  } | null = null;
  stopCalls = 0;
  /** When set, `stop()` rejects with it. */
  stopError: Error | null = null;

  constructor() {
    FakeConfigServer.instances.push(this);
  }

  onWebSocket(path: string, handler: WebSocketHandler): this {
    this.wsHandlers.set(path, handler);
    return this;
  }

  async start(
    port: number,
    handler: () => Promise<{ statusCode: number; body: string }>,
    config: { mounts: { type: string; path: string }[] },
    host?: string,
  ): Promise<number> {
    const error = FakeConfigServer.nextStartError;
    FakeConfigServer.nextStartError = null;
    if (error !== null) throw error;
    this.startArgs = { port, handler, config, host };
    return port;
  }

  async stop(): Promise<void> {
    this.stopCalls++;
    if (this.stopError) throw this.stopError;
  }

  /** Opens a new phone connection on `path`, as the native plugin would. */
  connect(path = "/ws"): FakeServerWebSocket {
    const handler = this.wsHandlers.get(path);
    if (!handler) throw new Error(`No WebSocket handler for ${path}`);
    const ws = new FakeServerWebSocket();
    handler(ws, { path, query: "", headers: {} });
    return ws;
  }

  /** The most recently constructed server. */
  static latest(): FakeConfigServer {
    const server = FakeConfigServer.instances.at(-1);
    if (!server) throw new Error("No ConfigServer was constructed");
    return server;
  }
}

// ─── nitro-http-server: static files ─────────────────────────────────────────

interface Deferred {
  promise: Promise<number>;
  resolve: (port: number) => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: (port: number) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<number>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class FakeStaticServer {
  static instances: FakeStaticServer[] = [];
  /** When set, the next `start()` rejects with it (then it is cleared). */
  static nextStartError: unknown = null;
  /**
   * When true, `start()` stays pending until the test calls
   * {@link FakeStaticServer.finishStart} — to model a slow native start.
   */
  static holdStart = false;

  startArgs: { port: number; rootDir: string; host?: string } | null = null;
  stopCalls = 0;
  private pending: Deferred | null = null;

  constructor() {
    FakeStaticServer.instances.push(this);
  }

  start(port: number, rootDir: string, host?: string): Promise<number> {
    this.startArgs = { port, rootDir, host };
    const error = FakeStaticServer.nextStartError;
    FakeStaticServer.nextStartError = null;
    if (error !== null) return Promise.reject(error);
    if (!FakeStaticServer.holdStart) return Promise.resolve(port);
    this.pending = deferred();
    return this.pending.promise;
  }

  /** Completes a start held by {@link FakeStaticServer.holdStart}. */
  finishStart(): void {
    if (!this.pending || !this.startArgs) throw new Error("No start pending");
    this.pending.resolve(this.startArgs.port);
    this.pending = null;
  }

  async stop(): Promise<void> {
    this.stopCalls++;
  }
}

mock.module("react-native-nitro-http-server", () => ({
  ConfigServer: FakeConfigServer,
  StaticServer: FakeStaticServer,
}));

// ─── expo-network ────────────────────────────────────────────────────────────

/** What `Network.getIpAddressAsync()` resolves to, or rejects with. */
export const network: { ip: string | null; error: unknown } = {
  ip: "192.168.1.20",
  error: null,
};

export const getIpAddressAsync = mock(async () => {
  if (network.error !== null) throw network.error;
  return network.ip;
});

mock.module("expo-network", () => ({ getIpAddressAsync }));

// ─── react-native ────────────────────────────────────────────────────────────

/** Mutable so a test can switch platforms; read by the source at call time. */
export const Platform: { OS: string } = { OS: "android" };

mock.module("react-native", () => ({ Platform }));

// ─── expo-file-system ────────────────────────────────────────────────────────

/**
 * A tiny filesystem: `assets` holds the APK's `asset:///www/...` contents,
 * `dirs` and `files` the writable document directory.
 */
export const fs = {
  assets: new Map<string, Uint8Array>(),
  dirs: new Set<string>(),
  files: new Map<string, Uint8Array>(),
  /** Every operation, in order — to assert the sequence of side effects. */
  log: [] as string[],
  /** When set, writing a file at this URI throws. */
  failWriteAt: null as string | null,
};

type UriLike = string | { uri: string };

function join(parent: UriLike, name?: string): string {
  const base = typeof parent === "string" ? parent : parent.uri;
  if (name === undefined) return base;
  return `${base.replace(/\/$/, "")}/${name}`;
}

export class FakeDirectory {
  readonly uri: string;

  constructor(parent: UriLike, name?: string) {
    this.uri = join(parent, name);
  }

  get exists(): boolean {
    return fs.dirs.has(this.uri);
  }

  create(): void {
    fs.log.push(`mkdir ${this.uri}`);
    fs.dirs.add(this.uri);
  }

  delete(): void {
    fs.log.push(`rm ${this.uri}`);
    const prefix = `${this.uri}/`;
    fs.dirs.delete(this.uri);
    for (const dir of [...fs.dirs]) {
      if (dir.startsWith(prefix)) fs.dirs.delete(dir);
    }
    for (const file of [...fs.files.keys()]) {
      if (file.startsWith(prefix)) fs.files.delete(file);
    }
  }
}

export class FakeFile {
  readonly uri: string;

  constructor(parent: UriLike, name?: string) {
    this.uri = join(parent, name);
  }

  bytesSync(): Uint8Array {
    const bytes = fs.assets.get(this.uri);
    if (!bytes) throw new Error(`Asset not found: ${this.uri}`);
    return bytes;
  }

  write(content: Uint8Array): void {
    if (fs.failWriteAt === this.uri) throw new Error("Disk full");
    fs.log.push(`write ${this.uri}`);
    fs.files.set(this.uri, content);
  }
}

/** `bundle` is mutable so a test can model Android, where it is missing. */
export const Paths: {
  document: FakeDirectory;
  bundle: { uri: string } | undefined;
} = {
  document: new FakeDirectory("file:///data/user/0/com.game/files"),
  bundle: { uri: "file:///var/containers/Bundle/Game.app/" },
};

mock.module("expo-file-system", () => ({
  Paths,
  File: FakeFile,
  Directory: FakeDirectory,
}));

// ─── Reset ───────────────────────────────────────────────────────────────────

export function resetNativeFakes(): void {
  FakeConfigServer.instances = [];
  FakeConfigServer.nextStartError = null;
  FakeStaticServer.instances = [];
  FakeStaticServer.nextStartError = null;
  FakeStaticServer.holdStart = false;
  network.ip = "192.168.1.20";
  network.error = null;
  getIpAddressAsync.mockClear();
  Platform.OS = "android";
  fs.assets.clear();
  fs.dirs.clear();
  fs.files.clear();
  fs.log.length = 0;
  fs.failWriteAt = null;
  Paths.bundle = { uri: "file:///var/containers/Bundle/Game.app/" };
}
