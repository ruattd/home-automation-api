import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { node } from '@elysiajs/node';

// create an instance of Elysia application
export const app = new Elysia({ adapter: node() });

app.use(swagger({
    path: "/docs",
    documentation: {
        info: {
            title: 'Home Automation API',
            description: 'A group of REST API to control home IoT devices',
            version: '1.0.0'
        }
    },
}));

const onCleanupList: (() => Promise<void>)[] = [];

export function onCleanup(func: () => Promise<void>) {
    onCleanupList.push(func);
}

let isExiting = false;
export async function exit() {
    if (isExiting) return;
    console.log("\nStopping Elysia server...");
    if (app.server) app.stop();
    console.log("Performing cleanup...");
    for (const func of onCleanupList) {
        try { await func(); } catch (err) { /* ignoring */ }
    }
    console.log("Exiting...");
    process.exit(0);
}
