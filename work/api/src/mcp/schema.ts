/**
 * Zod → JSON Schema, for the shapes MCP tools actually declare.
 *
 * Deliberately small rather than a general converter. Every tool's input here is an object of
 * strings, numbers, booleans and records — so a converter covering exactly that is a page of code
 * that is obviously correct, against a dependency that is not.
 *
 * If a tool ever needs a shape this cannot express, that is the moment to reach for the library —
 * not before.
 *
 * specs-service carries the same page (`specs/api/src/mcp/schema.ts`). It is copied, not imported:
 * the services share published contracts only, and a page this size is cheaper to keep twice than
 * to publish.
 */

import { z } from 'zod';

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  additionalProperties?: boolean | JsonSchema;
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = schema._def;

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    };
  }

  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodArray) return { type: 'array', items: zodToJsonSchema(schema.element) };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options as unknown[] };
  if (schema instanceof z.ZodRecord) return { type: 'object', additionalProperties: true };
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) return {};

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return zodToJsonSchema(def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodDefault) {
    return { ...zodToJsonSchema(def.innerType as z.ZodTypeAny), default: def.defaultValue() };
  }

  // An unrecognised shape becomes an unconstrained value rather than an exception. A tool that
  // still works with a looser schema beats a server that will not start.
  return {};
}
