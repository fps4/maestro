/**
 * The archive on a filesystem: the local development loop, and what an export unpacks to. The
 * verifier reads this with no service running.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SegmentManifest } from '../domain/segment.js';
import { DAY } from '../domain/segment.js';
import {
  type ArchiveHead,
  type ArchiveStore,
  HEAD_NAME,
  MANIFEST_NAME,
  joinLines,
  partName,
  partSeq,
  splitLines,
} from './port.js';

export class FsArchive implements ArchiveStore {
  constructor(readonly root: string) {}

  async readHead(workspace: string): Promise<ArchiveHead | null> {
    const raw = await readOrNull(join(this.root, workspace, HEAD_NAME));
    return raw === null ? null : (JSON.parse(raw) as ArchiveHead);
  }

  async writeHead(workspace: string, head: ArchiveHead): Promise<void> {
    await mkdir(join(this.root, workspace), { recursive: true });
    await writeFile(join(this.root, workspace, HEAD_NAME), JSON.stringify(head));
  }

  async putPart(
    workspace: string,
    day: string,
    firstSeq: number,
    lines: readonly string[],
  ): Promise<'written' | 'exists'> {
    const dir = join(this.root, workspace, day);
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(join(dir, partName(firstSeq)), joinLines(lines), { flag: 'wx' });
      return 'written';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
      throw error;
    }
  }

  async listParts(workspace: string, day: string): Promise<number[]> {
    const names = await readdirOrEmpty(join(this.root, workspace, day));
    return names
      .map(partSeq)
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
  }

  async readPart(workspace: string, day: string, firstSeq: number): Promise<string[]> {
    return splitLines(await readFile(join(this.root, workspace, day, partName(firstSeq)), 'utf8'));
  }

  async readManifest(workspace: string, day: string): Promise<SegmentManifest | null> {
    const raw = await readOrNull(join(this.root, workspace, day, MANIFEST_NAME));
    return raw === null ? null : (JSON.parse(raw) as SegmentManifest);
  }

  async putManifest(workspace: string, day: string, manifest: SegmentManifest): Promise<void> {
    const dir = join(this.root, workspace, day);
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(join(dir, MANIFEST_NAME), JSON.stringify(manifest), { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(`${workspace}/${day} is already sealed`);
      throw error;
    }
  }

  async listDays(workspace: string): Promise<string[]> {
    const names = await readdirOrEmpty(join(this.root, workspace));
    return names.filter((n) => DAY.test(n)).sort();
  }

  async listWorkspaces(): Promise<string[]> {
    const names = await readdirOrEmpty(this.root);
    return names.filter((n) => n.startsWith('ws-')).sort();
  }
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readdirOrEmpty(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
