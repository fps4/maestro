/**
 * An in-memory archive, for tests and for the in-process default. Same write-once discipline as the
 * real adapters, so a test that passes here is about the relay and not about the store.
 */

import type { SegmentManifest } from '../domain/segment.js';
import { type ArchiveHead, type ArchiveStore, partName, partSeq } from './port.js';

export class MemoryArchive implements ArchiveStore {
  readonly objects = new Map<string, string>();

  async readHead(workspace: string): Promise<ArchiveHead | null> {
    const raw = this.objects.get(`${workspace}/head.json`);
    return raw ? (JSON.parse(raw) as ArchiveHead) : null;
  }

  async writeHead(workspace: string, head: ArchiveHead): Promise<void> {
    this.objects.set(`${workspace}/head.json`, JSON.stringify(head));
  }

  async putPart(
    workspace: string,
    day: string,
    firstSeq: number,
    lines: readonly string[],
  ): Promise<'written' | 'exists'> {
    const key = `${workspace}/${day}/${partName(firstSeq)}`;
    if (this.objects.has(key)) return 'exists';
    this.objects.set(key, lines.map((l) => `${l}\n`).join(''));
    return 'written';
  }

  async listParts(workspace: string, day: string): Promise<number[]> {
    const prefix = `${workspace}/${day}/`;
    return [...this.objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => partSeq(k.slice(prefix.length)))
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
  }

  async readPart(workspace: string, day: string, firstSeq: number): Promise<string[]> {
    const raw = this.objects.get(`${workspace}/${day}/${partName(firstSeq)}`);
    if (raw === undefined) throw new Error(`no part ${workspace}/${day}/${partName(firstSeq)}`);
    return raw.split('\n').filter((l) => l.length > 0);
  }

  async readManifest(workspace: string, day: string): Promise<SegmentManifest | null> {
    const raw = this.objects.get(`${workspace}/${day}/segment.json`);
    return raw ? (JSON.parse(raw) as SegmentManifest) : null;
  }

  async putManifest(workspace: string, day: string, manifest: SegmentManifest): Promise<void> {
    const key = `${workspace}/${day}/segment.json`;
    if (this.objects.has(key)) throw new Error(`${workspace}/${day} is already sealed`);
    this.objects.set(key, JSON.stringify(manifest));
  }

  async listDays(workspace: string): Promise<string[]> {
    const prefix = `${workspace}/`;
    const days = new Set<string>();
    for (const key of this.objects.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash > 0) days.add(rest.slice(0, slash));
    }
    return [...days].sort();
  }

  async listWorkspaces(): Promise<string[]> {
    return [...new Set([...this.objects.keys()].map((k) => k.slice(0, k.indexOf('/'))))].sort();
  }
}
