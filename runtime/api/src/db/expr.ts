/**
 * Expression plumbing: attribute names and values numbered as they are used, so a caller writes a
 * condition as a sentence and never hand-assigns a placeholder.
 *
 *   const e = new Expr();
 *   e.condition(`${e.n('state')} = ${e.v('proposed')}`);
 *   e.set({ state: 'accepted', decided_at: now });
 *   e.remove(['pending_pk']);
 *   ...e.attributes()   → ExpressionAttributeNames / Values, ConditionExpression, UpdateExpression
 */

export type Attributes = {
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
};

export class Expr {
  private readonly names = new Map<string, string>();
  private readonly values: Record<string, unknown> = {};
  private conditions: string[] = [];
  private sets: string[] = [];
  private removes: string[] = [];
  private adds: string[] = [];

  /** A placeholder for an attribute name; a dotted path is placeholdered per segment. */
  n(path: string): string {
    return path
      .split('.')
      .map((segment) => {
        let placeholder = this.names.get(segment);
        if (!placeholder) {
          placeholder = `#n${this.names.size}`;
          this.names.set(segment, placeholder);
        }
        return placeholder;
      })
      .join('.');
  }

  /** A placeholder for a value. */
  v(value: unknown): string {
    const placeholder = `:v${Object.keys(this.values).length}`;
    this.values[placeholder] = value;
    return placeholder;
  }

  condition(clause: string): this {
    this.conditions.push(clause);
    return this;
  }

  /** `SET a = :a, b = :b` for every entry; an `undefined` value is skipped. */
  set(fields: Record<string, unknown>): this {
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      this.sets.push(`${this.n(field)} = ${this.v(value)}`);
    }
    return this;
  }

  /** `SET a = <raw expression>` — for list_append and arithmetic. */
  setRaw(field: string, expression: string): this {
    this.sets.push(`${this.n(field)} = ${expression}`);
    return this;
  }

  remove(fields: string[]): this {
    for (const field of fields) this.removes.push(this.n(field));
    return this;
  }

  add(field: string, by: number): this {
    this.adds.push(`${this.n(field)} ${this.v(by)}`);
    return this;
  }

  conditionExpression(): string | undefined {
    return this.conditions.length ? this.conditions.join(' AND ') : undefined;
  }

  updateExpression(): string {
    const parts: string[] = [];
    if (this.sets.length) parts.push(`SET ${this.sets.join(', ')}`);
    if (this.removes.length) parts.push(`REMOVE ${this.removes.join(', ')}`);
    if (this.adds.length) parts.push(`ADD ${this.adds.join(', ')}`);
    if (parts.length === 0) throw new Error('An update needs at least one SET, REMOVE or ADD.');
    return parts.join(' ');
  }

  attributes(): Attributes {
    const out: Attributes = {};
    if (this.names.size > 0) {
      out.ExpressionAttributeNames = Object.fromEntries([...this.names].map(([k, v]) => [v, k]));
    }
    if (Object.keys(this.values).length > 0) out.ExpressionAttributeValues = this.values;
    return out;
  }
}
