import path from "path";
import fs from "fs"
import { Worker } from "worker_threads";
import { app, onCleanup } from "../app.js";
import { t } from "elysia";
import { fileURLToPath } from "url";

// create worker thread for RF communication
const dir = path.dirname(fileURLToPath(import.meta.url));
let workerFilePath = path.resolve(dir, "rf_worker.js");
let usingTypeScript = false;
if (!fs.existsSync(workerFilePath)) {
    workerFilePath = path.resolve(dir, "rf_worker.ts");
    usingTypeScript = true;
}
const worker = usingTypeScript ? new Worker(`import('tsx/esm/api').then(({ register }) => { register(); import('${workerFilePath}') })`, { eval: true }) : new Worker(workerFilePath);

// pending task id to result map
const pendingTasks = new Map<number, { resolve: (result: string) => void, reject: (error: any) => void }>();
let taskIdCount = 0;

// register worker callback
worker.on("message", ({ id, result, error }) => {
    const handler = pendingTasks.get(id);
    if (handler) {
        if (error) handler.reject(error);
        else handler.resolve(result);
        pendingTasks.delete(id);
    }
})

/**
 * Send a RF command and get the ACK message.
 * @param command RF command text
 * @param timeout Waiting timeout (ms)
 * @returns RF ACK message
 */
function query(command: string, timeout: number = 1000): Promise<string> {
    return new Promise((resolve, reject) => {
        const id = taskIdCount++;
        pendingTasks.set(id, { resolve, reject });
        worker.postMessage({ id, data: { command, timeout } });
    });
}

// register api endpoint
app.post("/rf", async ({ body }) => {
    return await query(body.command, body.timeout);
}, {
    detail: {
        summary: "Use RF commands",
        description: "Send a RF command and get the ACK message.",
    },
    body: t.Object({
        command: t.String({ description: "RF command text" }),
        timeout: t.Optional(t.Number({ description: "Waiting timeout (ms)", default: 1000 })),
    }),
    response: {
        200: t.String({ description: "RF communication ACK message" }),
    }
});

// register clean up event

onCleanup(async () => {
    await worker.terminate();
});
