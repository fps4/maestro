/**
 * One structured log line per run, in CloudWatch's embedded metric format, so a count becomes a
 * metric an alarm can watch without a metrics client: relay refusals, segments sealed. The rest of
 * the line is the run's report, readable as it is.
 */

export interface Metric {
  name: string;
  value: number;
  unit?: 'Count' | 'Milliseconds';
}

export function emit(
  namespace: string,
  dimensions: Record<string, string>,
  metrics: readonly Metric[],
  report: Record<string, unknown>,
  log: (line: string) => void = (line) => console.log(line),
): void {
  const line: Record<string, unknown> = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: [Object.keys(dimensions)],
          Metrics: metrics.map((m) => ({ Name: m.name, Unit: m.unit ?? 'Count' })),
        },
      ],
    },
    ...dimensions,
    ...report,
  };
  for (const m of metrics) line[m.name] = m.value;
  log(JSON.stringify(line));
}

export const NAMESPACE = 'maestro/spine';
