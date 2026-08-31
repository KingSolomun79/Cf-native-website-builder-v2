import { describe, expect, it } from "vitest";
import { checkImages } from "../src/qa/checks/images";

function page(images: number): string {
  const tags = Array.from({ length: images }, (_, index) => `<img src="/image-${index}.webp" alt="Relevant image ${index}">`).join("");
  return `<html><body><main>${tags}</main></body></html>`;
}

describe("image markup QA", () => {
  it("requires the page-specific number of content images", () => {
    expect(checkImages(page(3), "/")).toBe("pass");
    expect(checkImages(page(2), "/")).toBe("fail");
    expect(checkImages(page(3), "/services")).toBe("pass");
    expect(checkImages(page(0), "/about")).toBe("fail");
    expect(checkImages(page(1), "/contact")).toBe("pass");
  });

  it("rejects missing source or alternative text", () => {
    expect(checkImages('<main><img src="/one.webp" alt=""><img src="/two.webp" alt="Two"><img src="/three.webp" alt="Three"></main>', "/")).toBe("fail");
  });
});
