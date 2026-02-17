import { status, t } from 'elysia';
import { SW, SW1, SW2, SW3, SW4 } from '../native/pin_definitions.js';
import { app, onCleanup } from '../app.js';
import rpio from 'rpio';
import { sleep } from '../util/time.js';

onCleanup(async () => {
    rpio.exit();
});

// initialize GPIO
rpio.init({
    mapping: 'gpio',
    close_on_exit: false,
});
for (const pin of SW) rpio.open(pin, rpio.OUTPUT);

function swInfo(name: string, pin: number, id: number) {
    const v = rpio.read(pin);
    return { name: name, value: v, id: id };
}

app.get('/sw', () => {
    return [
        swInfo("Realtek Sound", SW1, 1),
        swInfo("Underdesktop Heater", SW2, 2),
        swInfo("Empty", SW3, 3),
        swInfo("Empty", SW4, 4),
    ];
}, {
    detail: {
        summary: "Get switch info",
        description: "Get switch info list.",
    },
    response: {
        200: t.Array(t.Object({
            name: t.String({ description: "Device name" }),
            value: t.Number({ description: "Current value (0/1)" }),
            id: t.Number({ description: "Switch identity number" }),
        })),
    }
})

app.post('/sw/:id', async ({ params: { id }, query: { value } }) => {
    const pin = SW[id - 1];
    if (!pin) return new Response(undefined, { status: 404 });
    if (value !== undefined) rpio.write(pin, value);
    await sleep(100);
    return new Response(rpio.read(pin).toString());
}, {
    detail: {
        summary: "Get or set switch value",
        description: "Get or set the value of specified switch.",
    },
    params: t.Object({
        id: t.Number({ description: "Switch identity number" }),
    }),
    query: t.Object({
        value: t.Optional(t.Number({ description: "Value to set (0/1)" })),
    }),
    response: {
        200: t.Number({ description: "Current value of specified switch" }),
        404: t.Undefined({ description: "Switch not found" }),
    },
});
