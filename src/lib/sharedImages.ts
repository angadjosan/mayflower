// Screenshots and photos people text Mayflower (chats, articles, tweets) -> Claude image blocks for the agent.
// Images are passed to the model for this one turn only and never stored; what the agent learns from them is
// saved as memories (the user's own views), never the image or other people's details.
import { downloadAttachment, isImageAttachment, sniffImageType, type BBAttachment } from "./bluebubbles";
import type { SharedImage } from "./agent/agent";

/** Claude's per-image limit is 5 MB of base64-decoded data. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;

type Download = (guid: string, maxBytes: number) => Promise<{ data: Buffer } | "too_big" | null>;

export async function prepareSharedImages(
  attachments: BBAttachment[] | undefined,
  download: Download = downloadAttachment,
): Promise<{ images: SharedImage[]; notes: string[] }> {
  const images: SharedImage[] = [];
  const notes: string[] = [];
  const pics = (attachments ?? []).filter((a) => a.guid && isImageAttachment(a)).slice(0, MAX_IMAGES);
  for (const a of pics) {
    const file = await download(a.guid!, MAX_IMAGE_BYTES);
    if (file === "too_big") { notes.push("One image was too large to read; ask them for a smaller screenshot if it matters."); continue; }
    if (!file) { notes.push("One image couldn't be downloaded; ask them to resend it if it matters."); continue; }
    const type = sniffImageType(file.data);
    if (type === "image/heic" || !type) {
      notes.push("One image is a format you can't read (likely an iPhone HEIC photo); ask them to send a screenshot of it instead.");
      continue;
    }
    images.push({ mediaType: type, data: Buffer.from(file.data).toString("base64") });
  }
  return { images, notes };
}

/** What goes in chat history for a message that carried images (the images themselves are not stored). */
export function storedTextFor(typed: string, imageCount: number, notes: number): string {
  const n = imageCount + notes;
  if (!n) return typed;
  const tag = `[shared ${n === 1 ? "a screenshot/image" : `${n} screenshots/images`}]`;
  return typed ? `${typed}\n${tag}` : tag;
}
