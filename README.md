# Home Automation API

Native interop and REST APIs for Raspberry Pi home automation

## Usage

Clone this repo on your Raspberry Pi device.

Install dependencies:

```sh
pnpm i
```

Compile TypeScript codes:

```sh
pnpm build
```

Prepare the remote controller (RF reveiver).

Make a copy of `.env.example` to `.env` and edit it.

Start API server:

```sh
pnpm start
```

## Development

Just edit the code then use:

```sh
pnpm dev
```

to run TypeScript codes directly.
