const g = globalThis as unknown as { btoa?: (input: string) => string; atob?: (input: string) => string; Buffer?: any };

function encodeBinary(binary: string): string {
    if (typeof g.btoa === "function") {
        return g.btoa(binary);
    }
    if (g.Buffer) {
        return g.Buffer.from(binary, "binary").toString("base64");
    }
    throw new Error("Base64 encoding is not supported in this environment");
}

function decodeBase64(base64: string): string {
    if (typeof g.atob === "function") {
        return g.atob(base64);
    }
    if (g.Buffer) {
        return g.Buffer.from(base64, "base64").toString("binary");
    }
    throw new Error("Base64 decoding is not supported in this environment");
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return encodeBinary(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
    const binary = decodeBase64(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
