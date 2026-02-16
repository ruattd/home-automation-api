export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const INT32_ZERO = new Int32Array(new SharedArrayBuffer(4));
export function sleepSync(ms: number) {
    Atomics.wait(INT32_ZERO, 0, 0, ms);
}
