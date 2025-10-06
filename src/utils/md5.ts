const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
}

const SHIFT_AMOUNTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const textEncoder = new TextEncoder();

export function md5(input: ArrayBuffer | Uint8Array | string): string {
    let data: Uint8Array;
    if (typeof input === "string") {
        data = textEncoder.encode(input);
    } else if (input instanceof Uint8Array) {
        data = input;
    } else {
        data = new Uint8Array(input);
    }

    const originalLength = data.length;
    const bitLength = originalLength * 8;
    const paddedLength = ((originalLength + 8) >> 6 << 6) + 64;
    const buffer = new Uint8Array(paddedLength);
    buffer.set(data);
    buffer[originalLength] = 0x80;

    const view = new DataView(buffer.buffer);
    view.setUint32(paddedLength - 8, bitLength & 0xffffffff, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

    let a = 0x67452301;
    let b = 0xefcdab89;
    let c = 0x98badcfe;
    let d = 0x10325476;

    const M = new Uint32Array(16);

    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let j = 0; j < 16; j++) {
            M[j] = view.getUint32(offset + j * 4, true);
        }

        let A = a;
        let B = b;
        let C = c;
        let D = d;

        for (let i = 0; i < 64; i++) {
            let F: number;
            let g: number;
            if (i < 16) {
                F = (B & C) | (~B & D);
                g = i;
            } else if (i < 32) {
                F = (D & B) | (~D & C);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                F = B ^ C ^ D;
                g = (3 * i + 5) % 16;
            } else {
                F = C ^ (B | ~D);
                g = (7 * i) % 16;
            }

            const temp = D;
            D = C;
            C = B;
            const sum = (A + F + K[i] + M[g]) | 0;
            const rotated = ((sum << SHIFT_AMOUNTS[i]) | (sum >>> (32 - SHIFT_AMOUNTS[i]))) | 0;
            B = (B + rotated) | 0;
            A = temp;
        }

        a = (a + A) | 0;
        b = (b + B) | 0;
        c = (c + C) | 0;
        d = (d + D) | 0;
    }

    return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}

function toHex(value: number): string {
    const hex = (value >>> 0).toString(16);
    return hex.padStart(8, "0");
}
