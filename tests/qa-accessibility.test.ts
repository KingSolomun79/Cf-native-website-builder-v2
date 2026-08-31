import { describe, expect, it } from "vitest";
import { checkAccessibility } from "../src/qa/checks/accessibility";

const document = (body: string) => `<!doctype html><html lang="en"><body><a class="skip-link" href="#main">Skip to content</a><main id="main">${body}</main></body></html>`;

describe("accessibility QA check", () => {
  it("accepts labelled form controls and buttons with visible text", () => {
    expect(checkAccessibility(document('<button type="button">Open menu</button><label for="email">Email</label><input id="email" type="email"><label for="message">Message</label><textarea id="message"></textarea>'), "/contact")).toBe("pass");
  });

  it("rejects controls without an accessible name", () => {
    expect(checkAccessibility(document('<button type="button"></button>'), "/")).toBe("fail");
    expect(checkAccessibility(document('<input id="email" type="email">'), "/contact")).toBe("fail");
  });
});
