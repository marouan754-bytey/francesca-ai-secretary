import { describe, it, expect } from 'vitest';
import { smartExec, sanitizeCommand } from '../src/tools/terminal_exec.mjs';

describe('Terminal Execution (SmartExec)', () => {
  it('should execute a simple command successfully', async () => {
    const result = await smartExec('echo "hello world"');
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello world');
  });

  it('should analyze errors for non-existent commands', async () => {
    const result = await smartExec('nonexistentcommand12345');
    expect(result.success).toBe(false);
    expect(result.suggestion).toContain('not installed');
  });

  it('should block dangerous commands', async () => {
    expect(() => sanitizeCommand('rm -rf /')).toThrow('blocked');
    expect(() => sanitizeCommand(':(){ :|: & };:')).toThrow('blocked');
  });

  it('should map "start" to "xdg-open" on Linux', async () => {
    const cmd = sanitizeCommand('start https://google.com');
    expect(cmd).toContain('xdg-open "https://google.com"');
    expect(cmd).toContain('&');
  });

  it('should handle Windows-style URI schemes in start command', async () => {
    const cmd = sanitizeCommand('start microsoft-edge:');
    expect(cmd).toContain('xdg-open "microsoft-edge"');
  });

  it('should handle stderr as a warning but still succeed if exit code is 0', async () => {
    // Some commands write to stderr but don't fail (e.g. some git commands or custom scripts)
    const result = await smartExec('echo "error message" >&2');
    expect(result.success).toBe(true);
    expect(result.output).toContain('error message');
  });

  it('should respect timeouts', async () => {
    const result = await smartExec('sleep 2', { timeout: 100 });
    expect(result.success).toBe(false);
    expect(result.suggestion).toContain('took too long');
  }, 10000);
});
