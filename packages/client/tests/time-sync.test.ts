import { describe, expect, test } from "bun:test";
import { calculateTimeSync } from "../src/time-sync";

describe("Time Synchronization", () => {
  test("calculateTimeSync should determine correct offset", () => {
    // Scenario:
    // Client sends ping at T=1000
    // Server receives (instantly for math simplicity) at T=2000 (so server is +1000 ahead)
    // Server processes instantly
    // Client receives pong at T=1020 (RTT = 20ms)
    
    const clientSend = 1000;
    const clientReceive = 1020;
    const serverTimeReported = 2010; // Server time when it processed it (approx middle)

    // Expected:
    // RTT = 20
    // Latency = 10
    // Expected Server Time (at client receive) = 2010 + 10 = 2020
    // Actual Client Time (at client receive) = 1020
    // Offset = 2020 - 1020 = 1000

    const { offset, rtt } = calculateTimeSync(clientSend, clientReceive, serverTimeReported);

    expect(rtt).toBe(20);
    expect(offset).toBe(1000);
  });

  test("should handle negative offsets (client ahead of server)", () => {
    const clientSend = 2000;
    const clientReceive = 2020;
    const serverTimeReported = 1010; // Server is ~1000ms behind

    const { offset, rtt } = calculateTimeSync(clientSend, clientReceive, serverTimeReported);

    expect(rtt).toBe(20);
    // Expected Server Time = 1010 + 10 = 1020
    // Client Time = 2020
    // Offset = 1020 - 2020 = -1000
    expect(offset).toBe(-1000);
  });
});
