import { describe, it, expect } from "vitest";
import { cleanText, pagesBlock } from "./research";

describe("cleanText", () => {
  it("strips HTML, scripts and markdown images/links", () => {
    const html = `<html><script>var x=1</script><style>p{}</style><p>Hello&nbsp;<b>world</b> &amp; co</p>\n\n\n<p>Next</p></html>`;
    expect(cleanText(html)).toBe("Hello world & co\nNext");
    expect(cleanText("See ![chart](https://x/y.png) [Reuters](https://reuters.com) report")).toBe("See Reuters report");
  });
});

describe("pagesBlock", () => {
  it("numbers pages to match citations and skips unreadable ones", () => {
    const out = pagesBlock(
      [{ url: "https://a", text: "alpha", via: "context.dev" }, { url: "https://b", text: "", via: "none" }],
      [{ title: "B", url: "https://b" }, { title: "A", url: "https://a" }],
    );
    expect(out).toBe("--- [1] A (https://a)\nalpha");
  });
});
