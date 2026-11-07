import {build} from './build.mjs';
import {createApp} from './server.mjs';

build();
const app = createApp();
try {
  await app.listen();
} catch (error) {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${app.config.port} is already in use. Stop the other server or run PORT=4174 npm run dev.`
    : error.message);
  process.exit(1);
}
const env = await app.checkEnvironment();
console.log(`Zudo Bambu Blanks: http://127.0.0.1:${app.config.port}`);
console.log(`Template: ${app.config.templateSource === 'bundled' ? 'bundled assets/h2d-empty.3mf' : 'BAMBU_TEMPLATE override'}${env.template.ok ? ` (${env.template.printer}, ${env.template.processProfile})` : ` — ${env.template.message}`}`);
console.log(env.python.available ? `Python ${env.python.version}` : `3MF generation disabled: ${env.python.message}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
