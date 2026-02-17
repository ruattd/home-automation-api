import { app, exit } from './app.js';
import { PORT } from './args.js';

// import other modules
import './api/gpio.js';
import './api/rf.js';

process.on("SIGINT", exit);
process.on("SIGTERM", exit);
process.on("exit", exit);

// start listening
app.listen(PORT, () => {
    console.log(`API listening on ${PORT}`);
});
