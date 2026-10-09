import { createDb } from './client.ts';

const handle = createDb();
await handle.migrate();
await handle.close();
console.log('migrations applied');
