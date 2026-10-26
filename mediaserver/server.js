const { load } = require('./src/config');
const { createApp } = require('./src/app');
const { createLocalStorage } = require('./src/storage/local');

const config = load();
const app = createApp(config, createLocalStorage(config.root));

app.listen(config.port, config.host, () => {
  console.log(`[media] listening on http://${config.host}:${config.port}, storing in ${config.root}`);
});
