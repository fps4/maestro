/**
 * The module's grant holds every DynamoDB command the store sends.
 *
 * DynamoDB Local enforces no IAM: a command the code sends that terraform/main.tf does not grant
 * passes every test in this suite and refuses the first request on AWS (identity-service's boot
 * check did exactly that, once, over DescribeTimeToLive). The commands are read from the source,
 * the actions from the module; the table's own making and unmaking (the dev script's and the
 * tests') and Scan (the operator's, for a rebuild's drop) are the exceptions, named here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ACTION: Record<string, string> = {
  Get: 'GetItem',
  Put: 'PutItem',
  Update: 'UpdateItem',
  Delete: 'DeleteItem',
  BatchGet: 'BatchGetItem',
  BatchWrite: 'BatchWriteItem',
  TransactWrite: 'TransactWriteItems',
};
const NOT_A_FUNCTIONS = ['CreateTable', 'DeleteTable', 'UpdateTimeToLive', 'Scan'];

describe("the module's grant", () => {
  it('names every DynamoDB action the store sends at runtime', () => {
    const dir = resolve(__dirname, '../../src/db');
    const source = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(resolve(dir, f), 'utf-8'))
      .join('\n');
    const sent = [...new Set([...source.matchAll(/new (\w+)Command\(/g)].map((m) => m[1]!))].filter(
      (c) => !NOT_A_FUNCTIONS.includes(c),
    );
    const tf = readFileSync(resolve(__dirname, '../../../terraform/main.tf'), 'utf-8');
    const granted = new Set([...tf.matchAll(/"dynamodb:(\w+)"/g)].map((m) => m[1]!));
    expect(sent.length).toBeGreaterThan(5);
    for (const command of sent) {
      const action = ACTION[command] ?? command;
      expect(granted, `dynamodb:${action}, sent as ${command}Command, is not in terraform/main.tf`).toContain(
        action,
      );
    }
    // A ConditionCheck inside a transaction is its own action.
    if (/ConditionCheck:/.test(source)) expect(granted).toContain('ConditionCheckItem');
  });
});
