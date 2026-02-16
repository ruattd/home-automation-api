import { CrcLength, DataRate, PaLevel, RF24 } from "@rf24/rf24";
import { CE } from "./native/pin_definitions.js";
import { createInterface } from "readline/promises";
import { CHK, CMD, HELLO, NRF24TxSec, PacketType } from "./native/secure.js";

console.log("Initializing nRF24L01 radio...");

const KEY_MASTER = Buffer.from("CEcEc2026ltY0712");
const TX_ADDRESS = Buffer.from("L0712");
const CHANNEL = 60;

// initialize
const secure = new NRF24TxSec(KEY_MASTER, 217);
const radio = new RF24(CE, 0);
radio.begin();

// config
radio.channel = CHANNEL;
radio.paLevel = PaLevel.Max;
radio.addressLength = 5;
radio.dataRate = DataRate.Kbps250;
radio.crcLength = CrcLength.Bit8;
radio.ackPayloads = true;
radio.dynamicPayloads = true;

// perform as TX & set address
radio.asTx(TX_ADDRESS);

console.log("\nDetails:");
radio.printDetails();

// create readline tools
var rl = createInterface(process.stdin, process.stdout);
rl.on("SIGINT", () => {
    console.log("\nExiting...");
    radio.powerDown();
    rl.close();
    process.exit(0);
});

console.log("\nStart data transfer (TX)");

while (true) {
    // input & send packs
    const input = await rl.question("> ");
    if (input.length < 1) continue;
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
    console.log("Sending: %s", data.toString('hex'));
    const result = radio.send(data);
    if (result) {
        if (radio.available()) {
            const msg = radio.read().toString('utf-8');
            console.log("ACK message: %s", msg)
        }
    } else {
        console.log("Failed to send package");
    }
}
