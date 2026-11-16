/**
 * End-to-end tests for the Worker, against the real runtime.
 *
 * The routing rules are covered by `services/relay/tests`; what is specific to
 * this deployment is everything around them — the router, one Durable Object
 * per room, and a room's lifecycle in storage. None of that can be exercised
 * with a fake, so these start `wrangler dev --local` (workerd, no Cloudflare
 * account) and talk to it over real WebSockets.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** An origin on the allowlist in `wrangler.jsonc`. */
const ORIGIN = "http://localhost:5173";

const port = 20_000 + Math.floor(Math.random() * 20_000);
const http = `http://127.0.0.1:${port}`;
const ws = `ws://127.0.0.1:${port}`;

let server: ReturnType<typeof Bun.spawn>;
let stateDir: string;

/** Starts the Worker and waits until it answers. */
async function start(): Promise<void> {
  server = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--persist-to",
      stateDir,
    ],
    {
      cwd: join(import.meta.dir, ".."),
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
    },
  );

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${http}/healthz`)).ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error("wrangler dev did not start");
    await Bun.sleep(250);
  }
}

async function stop(): Promise<void> {
  server?.kill();
  await server?.exited;
}

/**
 * Stops the Worker and starts it again on the same storage. Every object loses
 * its memory and every socket, which is the worst a room has to survive — and
 * the only way to see what a room really left behind in storage.
 */
async function restart(): Promise<void> {
  await stop();
  await start();
}

beforeAll(async () => {
  // Its own state directory, so a run never sees rooms left by another.
  stateDir = mkdtempSync(join(tmpdir(), "relay-worker-test-"));
  await start();
}, 70_000);

afterAll(async () => {
  await stop();
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
});

interface Frame {
  type: string;
  [key: string]: unknown;
}

/** A socket whose frames and close can be awaited in order. */
class Peer {
  private readonly frames: Frame[] = [];
  private readonly waiting: ((frame: Frame) => void)[] = [];
  readonly closed: Promise<number>;

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      const frame = JSON.parse(String(event.data)) as Frame;
      const next = this.waiting.shift();
      if (next) next(frame);
      else this.frames.push(frame);
    };
    this.closed = new Promise((resolve) => {
      socket.onclose = (event) => resolve(event.code);
    });
  }

  static open(path: string, origin: string = ORIGIN): Promise<Peer> {
    return new Promise((resolve, reject) => {
      // Bun's WebSocket takes request headers; a browser sets Origin itself.
      const socket = new WebSocket(`${ws}${path}`, {
        headers: { Origin: origin },
      } as unknown as string[]);
      const peer = new Peer(socket);
      socket.onopen = () => resolve(peer);
      socket.onerror = () => reject(new Error(`could not open ${path}`));
    });
  }

  send(frame: Frame): void {
    this.socket.send(JSON.stringify(frame));
  }

  /** The next frame, in arrival order. */
  next(): Promise<Frame> {
    const frame = this.frames.shift();
    if (frame) return Promise.resolve(frame);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("no frame within 5s")),
        5_000,
      );
      this.waiting.push((f) => {
        clearTimeout(timer);
        resolve(f);
      });
    });
  }

  /** A clean close: the peer chose to leave. */
  leave(): Promise<number> {
    this.socket.close(1000, "done");
    return this.closed;
  }

  /** Drops the connection with no close frame, as a lost network does. */
  drop(): void {
    (this.socket as unknown as { terminate(): void }).terminate();
  }
}

/** Opens a room under `code` and returns its host and resume token. */
async function host(code: string): Promise<{ peer: Peer; token: string }> {
  const peer = await Peer.open(`/r/${code}`);
  peer.send({ type: "CREATE_ROOM", roomId: code });
  const created = await peer.next();
  expect(created.type).toBe("ROOM_CREATED");
  return { peer, token: created.resumeToken as string };
}

/** Joins `code` as a phone and returns it with its peer id. */
async function join_(code: string): Promise<{ peer: Peer; id: string }> {
  const peer = await Peer.open(`/r/${code}`);
  peer.send({ type: "JOIN_ROOM", roomId: code });
  const joined = await peer.next();
  expect(joined.type).toBe("ROOM_JOINED");
  return { peer, id: joined.peerId as string };
}

describe("router", () => {
  test("answers the health check without an origin", async () => {
    const res = await fetch(`${http}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("turns away origins that are not on the allowlist", async () => {
    const foreign = await fetch(http, {
      headers: { Origin: "https://evil.example" },
    });
    expect(foreign.status).toBe(403);
    const none = await fetch(http);
    expect(none.status).toBe(403);
    await expect(
      Peer.open("/r/ORIGIN", "https://evil.example"),
    ).rejects.toThrow();
  });

  test("refuses a socket that names no valid room", async () => {
    await expect(Peer.open("/")).rejects.toThrow();
    await expect(Peer.open("/r/not-a-code!")).rejects.toThrow();
  });
});

describe("a room", () => {
  test("routes between a host and a phone that typed the code in lowercase", async () => {
    const { peer: display } = await host("ROUTE");
    const { peer: phone, id } = await join_("route");

    const arrived = await display.next();
    expect(arrived).toMatchObject({ type: "PEER_JOINED", peerId: id });

    phone.send({ type: "DATA", data: "from-phone" });
    expect(await display.next()).toMatchObject({
      type: "DATA",
      data: "from-phone",
    });

    display.send({ type: "DATA", to: id, data: "from-display" });
    expect(await phone.next()).toMatchObject({
      type: "DATA",
      data: "from-display",
    });

    await display.leave();
  });

  test("gets its code from the relay when the display asks for one", async () => {
    const display = await Peer.open("/new");
    display.send({ type: "CREATE_ROOM" });
    const created = await display.next();
    expect(created.type).toBe("ROOM_CREATED");
    const code = created.roomId as string;
    expect(code).toMatch(/^[A-Z0-9]{1,16}$/);

    // The code has to lead back to the same object the display landed in.
    const { id } = await join_(code);
    expect(await display.next()).toMatchObject({
      type: "PEER_JOINED",
      peerId: id,
    });

    await display.leave();
  });

  test("tells a phone when there is no such room, then hangs up", async () => {
    const phone = await Peer.open("/r/NOBODY");
    phone.send({ type: "JOIN_ROOM", roomId: "NOBODY" });
    expect(await phone.next()).toMatchObject({
      type: "ERROR",
      code: "ROOM_NOT_FOUND",
    });
    // Left open, this socket would keep an object alive for a room that does
    // not exist.
    expect(await phone.closed).toBeGreaterThan(0);
  });

  test("ends with its host, and its code can be used again", async () => {
    const first = await host("AGAIN");
    const { peer: phone } = await join_("AGAIN");
    await first.peer.next(); // PEER_JOINED

    await first.peer.leave();
    expect(await phone.closed).toBe(4001);

    // Nothing of the first room may survive: not its membership, and not the
    // stored state that would make the object look occupied or resumable.
    const late = await Peer.open("/r/AGAIN");
    late.send({
      type: "CREATE_ROOM",
      roomId: "AGAIN",
      resumeToken: first.token,
    });
    expect(await late.next()).toMatchObject({
      type: "ERROR",
      code: "ROOM_NOT_FOUND",
    });
    await late.leave();

    const second = await host("AGAIN");
    expect(second.token).not.toBe(first.token);
    await second.peer.leave();
  });
});

describe("a display that drops", () => {
  test("takes its room back with the resume token, phones still in it", async () => {
    const first = await host("RESUME");
    const { peer: phone, id } = await join_("RESUME");
    await first.peer.next(); // PEER_JOINED

    first.peer.drop();
    await first.peer.closed;

    // Sent while nobody is hosting: held for the display, not lost.
    phone.send({ type: "DATA", data: "while-away" });

    const back = await Peer.open("/r/RESUME");
    back.send({
      type: "CREATE_ROOM",
      roomId: "RESUME",
      resumeToken: first.token,
    });
    expect(await back.next()).toMatchObject({
      type: "ROOM_RESUMED",
      roomId: "RESUME",
      peers: [id],
    });
    expect(await back.next()).toMatchObject({
      type: "DATA",
      data: "while-away",
    });

    await back.leave();
    expect(await phone.closed).toBe(4001);
  });

  test("cannot be impersonated with a wrong token", async () => {
    const first = await host("GUARD");
    first.peer.drop();
    await first.peer.closed;

    const thief = await Peer.open("/r/GUARD");
    thief.send({
      type: "CREATE_ROOM",
      roomId: "GUARD",
      resumeToken: "0".repeat(32),
    });
    expect(await thief.next()).toMatchObject({
      type: "ERROR",
      code: "ROOM_NOT_FOUND",
    });
    await thief.leave();

    // The real display is still welcome.
    const back = await Peer.open("/r/GUARD");
    back.send({
      type: "CREATE_ROOM",
      roomId: "GUARD",
      resumeToken: first.token,
    });
    expect((await back.next()).type).toBe("ROOM_RESUMED");
    await back.leave();
  });
});

// Last, because restarting drops every socket the tests above had open.
describe("after the relay loses its memory", () => {
  test("a waiting room is still there to resume, and an ended one is gone", async () => {
    const waiting = await host("KEPT");
    waiting.peer.drop();
    await waiting.peer.closed;

    const ended = await host("GONE");
    await ended.peer.leave();
    // The display's socket closes before the room has finished cleaning up
    // after it. A round trip through the same object waits that out: it
    // handles one event at a time, and holds its replies until its writes
    // are durable.
    const probe = await Peer.open("/r/GONE");
    probe.send({ type: "JOIN_ROOM", roomId: "GONE" });
    expect(await probe.next()).toMatchObject({ code: "ROOM_NOT_FOUND" });
    await probe.closed;

    await restart();

    const back = await Peer.open("/r/KEPT");
    back.send({
      type: "CREATE_ROOM",
      roomId: "KEPT",
      resumeToken: waiting.token,
    });
    expect((await back.next()).type).toBe("ROOM_RESUMED");
    await back.leave();

    const ghost = await Peer.open("/r/GONE");
    ghost.send({
      type: "CREATE_ROOM",
      roomId: "GONE",
      resumeToken: ended.token,
    });
    expect(await ghost.next()).toMatchObject({
      type: "ERROR",
      code: "ROOM_NOT_FOUND",
    });
    await ghost.leave();
  }, 90_000);
});

// Very last: this spends the whole connection budget of the address the tests
// come from.
describe("the connection limit", () => {
  test("stops one address from opening sockets without end", async () => {
    // Matches `ratelimits` in wrangler.jsonc.
    const limit = 60;
    const open: Peer[] = [];
    let refused = false;
    for (let attempt = 0; attempt <= limit; attempt++) {
      try {
        open.push(await Peer.open(`/r/LIMIT${attempt}`));
      } catch {
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
    // Earlier tests since the restart count against the same budget, so the
    // exact number varies — but most of it must still have been available.
    expect(open.length).toBeGreaterThan(limit / 2);
    expect(open.length).toBeLessThanOrEqual(limit);

    // Only new sockets are refused; nothing else about the relay changes.
    expect((await fetch(`${http}/healthz`)).status).toBe(200);
    await Promise.all(open.map((peer) => peer.leave()));
  }, 30_000);
});
