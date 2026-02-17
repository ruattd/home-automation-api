import 'dotenv/config';
import { parseArgs } from 'util';

// parse commandline args
const { values } = parseArgs({
    options: {
        // "debug": { type: "boolean", short: "d" },
        "port": { type: "string", short: "p" },
        "rf-passwd": { type: "string" },
        "rf-channel": { type: "string" },
        "rf-addr": { type: "string" },
        "rf-retry": { type: "string" },
    }
});

// parsing implementation
interface TypeMap {
    "number": number;
    "string": string;
    "boolean": boolean;
}
function parse<T extends keyof TypeMap>(key: string, targetType: T, defaultValue: TypeMap[T] | undefined = undefined): TypeMap[T] | undefined {
    const keyLower = key.toLowerCase().replaceAll("_", "-");
    const keyUpper = key.toUpperCase().replaceAll("-", "_");
    const value = (values as any)[keyLower] ?? process.env[keyUpper];
    if (value === undefined) return defaultValue;
    switch (targetType) {
        case "boolean": return Boolean(value) as TypeMap[T];
        case "number": return Number(value) as TypeMap[T];
        case "string": return value;
    }
}

// export results
export const PORT = parse("port", "number", 3000)!;
export const RF_PASSWD = parse("rf-passwd", "string", "0000000000000000")!;
export const RF_CHANNEL = parse("rf-channel", "number", 76)!;
export const RF_ADDR = parse("rf-addr", "string", "ABCDE")!;
export const RF_RETRY = parse("rf-retry", "number", 3)!;
