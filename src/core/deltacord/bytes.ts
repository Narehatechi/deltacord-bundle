/** Small helpers for downloading binary files without relying on a Buffer polyfill. */

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
    const parts: string[] = [];
    let chunk = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
        const n = (a << 16) | (b << 8) | c;
        chunk += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63]
            + (i + 1 < bytes.length ? CHARS[(n >> 6) & 63] : "=")
            + (i + 2 < bytes.length ? CHARS[n & 63] : "=");
        if (chunk.length >= 8192) {
            parts.push(chunk);
            chunk = "";
        }
    }
    parts.push(chunk);
    return parts.join("");
}

/** Works out an image or sound type from its first bytes. */
export function sniffType(bytes: Uint8Array, fallback = "application/octet-stream"): string {
    const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
    if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
    if (ascii(0, 4) === "GIF8") return "image/gif";
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return "image/jpeg";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
    if (ascii(0, 4) === "OggS") return "audio/ogg";
    if (ascii(0, 3) === "ID3" || (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0)) return "audio/mpeg";
    return fallback;
}

export async function download(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
}
