import { describe, it, expect } from 'vitest';
import { config } from '../src/config.mjs';

describe('Configuration', () => {
  it('should have a port', () => {
    expect(config.port).toBeDefined();
    expect(typeof config.port).toBe('number');
  });

  it('should have a master key', () => {
    expect(config.masterKey).toBeDefined();
  });

  it('should have a proxy URL', () => {
    expect(config.proxyUrl).toBeDefined();
    expect(config.proxyUrl).toMatch(/^https?:\/\//);
  });
});
