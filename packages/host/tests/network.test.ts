import { network, resetNativeFakes } from "./helpers/native-fakes";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Loaded after the native mocks are registered.
const { getBestIpAddress } = await import("../src/network");

const originalWarn = console.warn;

beforeEach(resetNativeFakes);
afterEach(() => {
  console.warn = originalWarn;
});

describe("getBestIpAddress", () => {
  test("returns the device's LAN address", async () => {
    network.ip = "10.0.0.7";
    expect(await getBestIpAddress()).toBe("10.0.0.7");
  });

  test.each(["0.0.0.0", "127.0.0.1", ""])(
    "treats %p as no usable address",
    async (ip) => {
      network.ip = ip;
      expect(await getBestIpAddress()).toBeNull();
    },
  );

  test("returns null when no address is reported", async () => {
    network.ip = null;
    expect(await getBestIpAddress()).toBeNull();
  });

  test("returns null and warns when the lookup throws", async () => {
    const warn = mock(() => {});
    console.warn = warn;
    network.error = new Error("no network permission");

    expect(await getBestIpAddress()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
