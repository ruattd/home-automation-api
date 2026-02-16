import { parentPort } from "worker_threads";
import { CrcLength, DataRate, PaLevel, RF24 } from "@rf24/rf24";
import { CHK, CMD, HELLO, NRF24TxSec, PacketType } from "../native/secure.js";
import { CE } from "../native/pin_definitions.js";
import { RF_ADDR, RF_CHANNEL, RF_PASSWD, RF_RETRY } from "../args.js";
import { randomInt } from "crypto";
import { sleepSync } from "../util/time.js";

// constants
const KEY_MASTER = Buffer.from(RF_PASSWD);
const TX_ADDRESS = Buffer.from(RF_ADDR);

// initialize
const secure = new NRF24TxSec(KEY_MASTER, 217);
const radio = new RF24(CE, 0);
radio.begin();

// config
radio.channel = RF_CHANNEL;
radio.paLevel = PaLevel.Max;
radio.addressLength = 5;
radio.dataRate = DataRate.Kbps250;
radio.crcLength = CrcLength.Bit8;
radio.ackPayloads = true;
radio.dynamicPayloads = true;

// perform as TX & set address
radio.asTx(TX_ADDRESS);

function execute(input: string): string | undefined {
    if (input.length < 1) return undefined;
    let firstSpace = input.indexOf(" ");
    if (firstSpace == -1) firstSpace = input.length;
    let inputCmd = input.substring(0, firstSpace).toLowerCase();
    let payload = input.substring(firstSpace);
    if (inputCmd != "cmd" && inputCmd != "chk" && inputCmd != "hello") {
        payload = input;
        inputCmd = "cmd"
    }
    payload = payload.trim();
    let cmd: PacketType = 0
    switch (inputCmd) {
        case "cmd": cmd = CMD; break;
        case "chk": cmd = CHK; break;
        case "hello": cmd = HELLO; break;
    }
    const data = secure.encode(cmd, Buffer.from(payload));
    const result = radio.send(data);
    if (!result) return undefined;
    if (!radio.available()) return "";
    const msg = radio.read().toString('utf-8');
    return msg;
}

function resetSession() {
    secure.sid = randomInt(0, 255);
    secure.seq = randomInt(0, 9);
    execute("hello");
    execute("chk");
}

// first handshake
resetSession();

/**
 * @param command RF command text
 * @param timeout Waiting timeout (ms)
 */
function querySync(command: string, timeout: number): string {
    let result = execute(`cmd ${command}`);
    if (result === undefined) throw new Error("RF communication failed");
    let failCnt = 0;
    sleepSync(timeout);
    while ((result = execute("chk")) === "") {
        if (failCnt++ > RF_RETRY) {
            if (failCnt > 2 * RF_RETRY) throw new Error("RF communication no response");
            resetSession();
        }
        sleepSync(timeout);
    }
    return result ?? "";
}

parentPort!.on("close", () => {
    radio.powerDown();
});

parentPort!.on("message", ({ id, data }) => {
    try {
        const result = querySync(data.command, data.timeout)
        parentPort!.postMessage({ id, result });
    } catch (error) {
        parentPort!.postMessage({ id, error });
    }
});
