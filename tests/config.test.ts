/**
 * @fileoverview Unit tests for configuration resolver (resolveConfig).
 * Verifies CLI argument parsing for roles, storage directory overrides,
 * watch mode flags, and environment variable fallbacks with proper precedence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.AGENT_ROLE;
    delete process.env.AGENT_BRIDGE_DIR;
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('resolves watch subcommand and --watch flag', () => {
    expect(resolveConfig(['watch']).isWatch).toBe(true);
    expect(resolveConfig(['--watch']).isWatch).toBe(true);
    expect(resolveConfig(['watch', '--role', 'navigator']).isWatch).toBe(true);
    expect(resolveConfig([]).isWatch).toBe(false);
  });

  it('parses --storage-dir flag both with space and equals', () => {
    expect(resolveConfig(['--storage-dir', '/custom/path']).storageDir).toBe('/custom/path');
    expect(resolveConfig(['--storage-dir=/custom/path']).storageDir).toBe('/custom/path');
  });

  it('parses --role flag both with space and equals', () => {
    expect(resolveConfig(['--role', 'navigator']).role).toBe('navigator');
    expect(resolveConfig(['--role=navigator']).role).toBe('navigator');
    expect(resolveConfig(['--role', 'driver']).role).toBe('driver');
    expect(resolveConfig(['--role=driver']).role).toBe('driver');
  });

  it('prioritizes command line args over environment variables', () => {
    process.env.AGENT_ROLE = 'navigator';
    process.env.AGENT_BRIDGE_DIR = '/env/path';
    const config = resolveConfig(['--role', 'driver', '--storage-dir', '/cli/path']);
    expect(config.role).toBe('driver');
    expect(config.storageDir).toBe('/cli/path');
    expect(config.isWatch).toBe(false);
  });

  it('falls back to environment variables when CLI flags are absent', () => {
    process.env.AGENT_ROLE = 'navigator';
    process.env.AGENT_BRIDGE_DIR = '/env/path';
    const config = resolveConfig([]);
    expect(config.role).toBe('navigator');
    expect(config.storageDir).toBe('/env/path');
    expect(config.isWatch).toBe(false);
  });

  it('defaults to driver role and undefined storageDir when no config is provided', () => {
    const config = resolveConfig([]);
    expect(config.role).toBe('driver');
    expect(config.storageDir).toBeUndefined();
    expect(config.isWatch).toBe(false);
  });
});
