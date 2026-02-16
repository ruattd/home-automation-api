// nrf24_secure_tx.ts
// Node/TypeScript sender-side encoder for the agreed variable-length packet spec.
//
// Packet (variable length):
//   header4 = seq(2 LE) || meta(1: (type<<5)|len) || sid(1)
//   ciphertext = len bytes (0..20)
//   tag = CMAC_AES128(K_mac, header4||ciphertext) truncated (default 8 bytes)
// Total length = 4 + len + tagLen  (12..32 when len 0..20 and tagLen=8)
//
// Crypto:
//   K_enc, K_mac derived from K_master via AES-ECB on constant blocks.
//   CTR keystream via AES-ECB: ctrBlock = [sid][meta][seqLE16][blockIndex][0x00*11]
//
// Exports:
//   CMD=0, CHK=1, HELLO=7
//   class SecureNRF24Tx { encode(type, payload, sid?, seq?) }

import { createCipheriv } from "crypto";

export const CMD = 0 as const;
export const CHK = 1 as const;
export const HELLO = 7 as const;

export type PacketType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type TagLen = 4 | 6 | 8;

function assert(cond: any, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

function aesEcbEncryptBlock(
    key16: Buffer,
    block16: Buffer,
): Buffer<ArrayBuffer> {
    assert(key16.length === 16, "AES-128 key must be 16 bytes");
    assert(block16.length === 16, "AES block must be 16 bytes");
    const cipher = createCipheriv("aes-128-ecb", key16, null);
    cipher.setAutoPadding(false);
    const out = Buffer.concat([cipher.update(block16), cipher.final()]);
    assert(out.length === 16, "ECB encrypt must output 16 bytes");
    return out;
}

function kdfTwoKeys(kMaster16: Buffer): { kEnc: Buffer; kMac: Buffer } {
    const b1 = Buffer.concat([
        Buffer.from("ENC\0", "ascii"),
        Buffer.alloc(12, 0x00),
    ]);
    const b2 = Buffer.concat([
        Buffer.from("MAC\0", "ascii"),
        Buffer.alloc(12, 0x00),
    ]);
    return {
        kEnc: aesEcbEncryptBlock(kMaster16, b1),
        kMac: aesEcbEncryptBlock(kMaster16, b2),
    };
}

// ----- CMAC (NIST SP 800-38B) -----

function xor16(a: Buffer, b: Buffer): Buffer {
    const o = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) o[i] = a[i]! ^ b[i]!;
    return o;
}

function leftShift1_128(b16: Buffer): Buffer {
    const out = Buffer.alloc(16);
    let carry = 0;
    for (let i = 15; i >= 0; i--) {
        const v = b16[i];
        out[i] = ((v! << 1) & 0xff) | carry;
        carry = v! & 0x80 ? 1 : 0;
    }
    return out;
}

function cmacSubkeys(kMac: Buffer): { K1: Buffer; K2: Buffer } {
    const L = aesEcbEncryptBlock(kMac, Buffer.alloc(16, 0x00));
    const rb = 0x87;

    let K1 = leftShift1_128(L);
    if (L[0]! & 0x80) {
        K1 = Buffer.from(K1);
        K1[15]! ^= rb;
    }

    let K2 = leftShift1_128(K1);
    if (K1[0]! & 0x80) {
        K2 = Buffer.from(K2);
        K2[15]! ^= rb;
    }

    return { K1, K2 };
}

function cmacAes128(kMac: Buffer, msg: Buffer): Buffer {
    const { K1, K2 } = cmacSubkeys(kMac);

    const n = msg.length === 0 ? 1 : Math.ceil(msg.length / 16);
    const lastComplete = msg.length !== 0 && msg.length % 16 === 0;

    let last: Buffer;
    if (lastComplete) {
        const Mlast = msg.subarray((n - 1) * 16, n * 16);
        last = xor16(Mlast, K1);
    } else {
        const Mlast = msg.subarray((n - 1) * 16);
        const padded = Buffer.alloc(16, 0x00);
        Mlast.copy(padded, 0);
        padded[Mlast.length] = 0x80;
        last = xor16(padded, K2);
    }

    let X = Buffer.alloc(16, 0x00);
    for (let i = 0; i < n - 1; i++) {
        const Mi = msg.subarray(i * 16, i * 16 + 16); // full block
        X = aesEcbEncryptBlock(kMac, xor16(X, Mi));
    }
    return aesEcbEncryptBlock(kMac, xor16(X, last));
}

// ----- CTR via ECB keystream -----

function ctrCrypt(
    kEnc: Buffer,
    sid: number,
    meta: number,
    seq: number,
    data: Buffer,
): Buffer {
    const out = Buffer.alloc(data.length);

    const seqLE0 = seq & 0xff;
    const seqLE1 = (seq >>> 8) & 0xff;

    for (let i = 0; i < data.length; i += 16) {
        const blockIndex = (i / 16) & 0xff;

        // ctrBlock = [sid][meta][seqLE16][blockIndex][0x00*11]
        const ctr = Buffer.alloc(16, 0x00);
        ctr[0] = sid & 0xff;
        ctr[1] = meta & 0xff;
        ctr[2] = seqLE0;
        ctr[3] = seqLE1;
        ctr[4] = blockIndex;

        const ks = aesEcbEncryptBlock(kEnc, ctr);
        const chunk = data.subarray(i, Math.min(i + 16, data.length));
        for (let j = 0; j < chunk.length; j++) {
            out[i + j] = chunk[j]! ^ ks[j]!;
        }
    }
    return out;
}

// ----- Public class -----

export class NRF24TxSec {
    private readonly kEnc: Buffer;
    private readonly kMac: Buffer;
    private _sid: number;
    private _seq: number;
    private readonly tagLen: TagLen;

    /**
     * @param kMaster16 16-byte PSK
     * @param sid initial session id (0..255)
     * @param seq initial sequence (0..65535)
     * @param tagLen 4|6|8 (default 8)
     */
    constructor(
        kMaster16: Buffer,
        sid: number,
        seq: number = 0,
        tagLen: TagLen = 8,
    ) {
        assert(
            Buffer.isBuffer(kMaster16) && kMaster16.length === 16,
            "kMaster16 must be 16-byte Buffer",
        );
        assert(
            Number.isInteger(sid) && sid >= 0 && sid <= 255,
            "sid must be 0..255",
        );
        assert(
            Number.isInteger(seq) && seq >= 0 && seq <= 0xffff,
            "seq must be 0..65535",
        );
        assert(
            tagLen === 4 || tagLen === 6 || tagLen === 8,
            "tagLen must be 4, 6, or 8",
        );

        const { kEnc, kMac } = kdfTwoKeys(kMaster16);
        this.kEnc = kEnc;
        this.kMac = kMac;
        this._sid = sid;
        this._seq = seq;
        this.tagLen = tagLen;
    }

    get sid(): number {
        return this._sid;
    }
    get seq(): number {
        return this._seq;
    }

    /** Set session id (e.g., after restart before sending HELLO) */
    set sid(value: number) {
        assert(
            Number.isInteger(value) && value >= 0 && value <= 255,
            "sid must be 0..255",
        );
        this._sid = value;
    }

    /** Set seq (e.g., after restart) */
    set seq(value: number) {
        assert(
            Number.isInteger(value) && value >= 0 && value <= 0xffff,
            "seq must be 0..65535",
        );
        this._seq = value;
    }

    /**
     * Encode one packet.
     * By default uses the instance's current sid/seq and then auto-increments seq.
     *
     * @param type 0..7
     * @param payload 0..20 bytes
     * @param sidOverride optional sid override for this packet only
     * @param seqOverride optional seq override for this packet only (does NOT change internal counter unless you want it to)
     */
    encode(
        type: PacketType,
        payload: Buffer,
        sidOverride?: number,
        seqOverride?: number,
    ): Buffer {
        assert(
            Number.isInteger(type) && type >= 0 && type <= 7,
            "type must be 0..7",
        );
        assert(Buffer.isBuffer(payload), "payload must be Buffer");
        assert(
            payload.length >= 0 && payload.length <= 20,
            "payload length must be 0..20",
        );

        const sid = sidOverride === undefined ? this._sid : sidOverride;
        const seq = seqOverride === undefined ? this._seq : seqOverride;

        assert(
            Number.isInteger(sid) && sid >= 0 && sid <= 255,
            "sid must be 0..255",
        );
        assert(
            Number.isInteger(seq) && seq >= 0 && seq <= 0xffff,
            "seq must be 0..65535",
        );

        const len = payload.length;
        const meta = ((type & 0x07) << 5) | (len & 0x1f);

        const header4 = Buffer.alloc(4);
        header4.writeUInt16LE(seq & 0xffff, 0);
        header4[2] = meta;
        header4[3] = sid & 0xff;

        const ciphertext = ctrCrypt(this.kEnc, sid, meta, seq, payload);
        const fullTag = cmacAes128(this.kMac, Buffer.concat([header4, ciphertext]));
        const tag = fullTag.subarray(0, this.tagLen);

        // auto-increment internal seq only when we used internal seq
        if (seqOverride === undefined) {
            this._seq = (this._seq + 1) & 0xffff;
        }

        return Buffer.concat([header4, ciphertext, tag]);
    }

    /** Convenience helpers */
    encodeCommand(payload: Buffer): Buffer {
        return this.encode(CMD, payload);
    }
    encodeHello(payload: Buffer = Buffer.alloc(0)): Buffer {
        return this.encode(HELLO, payload);
    }
    encodeCheck(): Buffer {
        return this.encode(CHK, Buffer.alloc(0));
    }
}
