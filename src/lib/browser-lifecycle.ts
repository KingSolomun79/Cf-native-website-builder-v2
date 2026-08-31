export interface ClosableBrowser {
  close(): Promise<void>;
}

export async function withBrowser<T extends ClosableBrowser, R>(
  browser: T,
  task: (browser: T) => Promise<R>
): Promise<R> {
  try {
    return await task(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}
