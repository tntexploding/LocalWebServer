import type {FastifyInstance} from 'fastify';

const SHUTDOWN_TIMEOUT_MS = 15_000;
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** Closes Fastify and its managed resources when the process is stopped. */
export function installGracefulShutdown(app: FastifyInstance): void {
  let shuttingDown = false;

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info({signal}, 'Graceful shutdown started.');

      const timeout = setTimeout(() => {
        app.log.error({signal}, 'Graceful shutdown timed out.');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      timeout.unref();

      void app.close().then(
        () => clearTimeout(timeout),
        error => {
          clearTimeout(timeout);
          process.exitCode = 1;
          app.log.error({error, signal}, 'Graceful shutdown failed.');
        },
      );
    });
  }
}
