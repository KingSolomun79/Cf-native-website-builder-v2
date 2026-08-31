import { describe, expect, it, vi } from "vitest";
import { withBrowser } from "../src/lib/browser-lifecycle";

describe("withBrowser", () => {
  it("closes the browser when persistence fails and preserves the failure", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const browser = { close };
    const persistenceFailure = new Error("simulated persistence failure");

    await expect(withBrowser(browser, async () => {
      throw persistenceFailure;
    })).rejects.toBe(persistenceFailure);

    expect(close).toHaveBeenCalledOnce();
  });

  it("does not replace a successful result when browser close fails", async () => {
    const browser = {
      close: vi.fn().mockRejectedValue(new Error("close failed")),
    };

    await expect(withBrowser(browser, async () => "persisted")).resolves.toBe("persisted");
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
