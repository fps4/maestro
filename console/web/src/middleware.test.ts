import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { publicOrigin } from './middleware';

const at = (headers: Record<string, string>) =>
  new NextRequest('http://localhost:8080/artifacts', { headers: new Headers(headers) });

describe('the public origin', () => {
  it('is the host and scheme the edge forwarded', () => {
    expect(
      publicOrigin(
        at({
          host: 'localhost:8080',
          'x-forwarded-host': 'maestro.tenant1.example',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe('https://maestro.tenant1.example');
  });

  it('is the Host header when nothing was forwarded', () => {
    expect(publicOrigin(at({ host: 'maestro.tenant1.example', 'x-forwarded-proto': 'https' }))).toBe(
      'https://maestro.tenant1.example',
    );
    expect(publicOrigin(at({ host: 'localhost:8021' }))).toBe('http://localhost:8021');
  });

  it('takes the first of a forwarded list', () => {
    expect(
      publicOrigin(at({ 'x-forwarded-host': 'a.example, b.example', 'x-forwarded-proto': 'https, http' })),
    ).toBe('https://a.example');
  });
});
