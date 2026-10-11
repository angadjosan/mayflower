import { describe, expect, it } from "vitest";
import { prepareSharedImages, storedTextFor } from "./sharedImages";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(8)]);

describe("shared images", () => {
  it("turns image attachments into Claude image blocks and explains the ones it can't read", async () => {
    const files: Record<string, Buffer | "too_big" | null> = { a: PNG, b: HEIC, c: "too_big", d: null };
    const r = await prepareSharedImages(
      [
        { guid: "a", mimeType: "image/png", transferName: "IMG_1.png" },
        { guid: "b", transferName: "IMG_2.HEIC" },
        { guid: "c", uti: "public.jpeg" },
        { guid: "d", mimeType: "image/jpeg" },
        { guid: "e", mimeType: "audio/mp3", uti: "com.apple.coreaudio-format" },
      ],
      async (g) => { const f = files[g]; return f === "too_big" || f === null ? f : { data: f }; },
    );
    expect(r.images).toEqual([{ mediaType: "image/png", data: PNG.toString("base64") }]);
    expect(r.notes).toHaveLength(3);
    expect(r.notes[0]).toMatch(/HEIC/);
  });
  it("records a placeholder in history instead of the image", () => {
    expect(storedTextFor("", 1, 0)).toBe("[shared a screenshot/image]");
    expect(storedTextFor("look at this", 2, 0)).toBe("look at this\n[shared 2 screenshots/images]");
    expect(storedTextFor("hi", 0, 0)).toBe("hi");
  });
});
