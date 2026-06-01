import { loadConfig } from './config';
import { Hub } from './hub';
import { createServer } from './api/server';
import { startDiscovery } from './discovery/discovery';
import { log, setLogLevel } from './logger';

function main(): void {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const hub = new Hub({ config });
  hub.start();

  const server = createServer(hub);
  const discovery = startDiscovery(config, hub.store.getHubId());

  server.listen(config.port, config.host, () => {
    log.info('ConsoleGate Hub listening', {
      host: config.host,
      port: config.port,
      hubId: hub.store.getHubId(),
      tz: config.tz,
      pinSet: hub.auth.isPinSet(),
    });
  });

  const shutdown = (sig: string) => {
    log.info('shutting down', { sig });
    discovery.stop();
    hub.stop();
    server.close(() => process.exit(0));
    // Force-exit if connections linger.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
