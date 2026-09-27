import type { Config } from '../config.js';
import { LogSignalSink, WorkSignalSink, type SignalSink } from './sink.js';

/** The signal sink the configuration names (`SIGNALS`): work-service's intake, or a log line. */
export function signalSinkFor(config: Config): SignalSink {
  if (config.SIGNALS === 'work') {
    return new WorkSignalSink({
      workApiUrl: config.WORK_API_URL!,
      tokenUrl: config.SIGNALS_TOKEN_URL!,
      clientId: config.SIGNALS_CLIENT_ID!,
      clientSecret: config.SIGNALS_CLIENT_SECRET!,
    });
  }
  return new LogSignalSink();
}
