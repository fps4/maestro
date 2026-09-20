// The heartbeat: one datapoint on maestro/heartbeat every five minutes, so silence is a metric
// the silence alarm can watch. Runs on Node 22, which carries the AWS SDK; nothing is bundled.
// Two copies of this file exist — signals/terraform/heartbeat/index.js, zipped by the module, and
// signals/cdk/heartbeat/index.js, inlined by the construct — and a test in signals/cdk keeps them identical.
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

const client = new CloudWatchClient({});

exports.handler = async () => {
  await client.send(
    new PutMetricDataCommand({
      Namespace: 'maestro/heartbeat',
      MetricData: [
        {
          MetricName: 'Heartbeat',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'application', Value: process.env.APPLICATION },
            { Name: 'environment', Value: process.env.ENVIRONMENT },
          ],
        },
      ],
    }),
  );
};
