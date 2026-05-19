import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { logEvent } from '../modules/logger.mjs';

const execPromise = promisify(exec);

/**
 * System Context Information
 */
export function getSystemContext() {
  return {
    platform: os.platform(),
    release: os.release(),
    shell: os.userInfo().shell || 'default',
    home: os.homedir(),
    arch: os.arch(),
    uptime: os.uptime(),
  };
}

/**
 * Error Analyzer for Self-Healing
 */
function analyzeError(err) {
  const msg = err.message.toLowerCase();

  if (
    msg.includes('command not found') ||
    msg.includes('not recognized') ||
    msg.includes('not found')
  ) {
    return 'REPAIR_SUGGESTION: The software is not installed or the command is not in the PATH. Try installing it with the local package manager (apt, npm, etc.).';
  }
  if (msg.includes('permission denied') || msg.includes('eacces')) {
    return "REPAIR_SUGGESTION: Permission error. You might need 'sudo' or to change ownership/permissions (chmod/chown).";
  }
  if (msg.includes('no such file or directory')) {
    return "REPAIR_SUGGESTION: Wrong path. Verify the current directory with 'ls' or 'pwd'.";
  }
  if (err.killed || msg.includes('timeout') || msg.includes('timed out')) {
    return 'REPAIR_SUGGESTION: The command took too long and was terminated. Try running it in the background or optimizing it.';
  }
  return 'UNKNOWN_ERROR: Analyze the log and try an alternative strategy.';
}

/**
 * Cross-Platform Command Sanitizer
 */
export function sanitizeCommand(command) {
  const platform = os.platform();
  let sanitized = command.trim();

  if (platform === 'linux') {
    if (sanitized.toLowerCase() === 'cls') return 'clear';

    // Wikipedia Mapping
    if (sanitized.toLowerCase().startsWith('wikipedia ')) {
      const topic = sanitized.substring(10).trim();
      return `xdg-open "https://it.wikipedia.org/wiki/${encodeURIComponent(topic)}" > /dev/null 2>&1 &`;
    }

    if (sanitized.toLowerCase().startsWith('start ')) {
      // On Linux, 'xdg-open' is the equivalent of Windows 'start' for files/URIs
      const target = sanitized.substring(6).trim();
      // Remove trailing ':' if it's a URI scheme attempt from Windows (e.g. microsoft-edge:)
      const cleanTarget = target.endsWith(':') ? target.slice(0, -1) : target;
      return `xdg-open "${cleanTarget}" > /dev/null 2>&1 &`;
    }
  }

  // Block extremely dangerous commands (even for Admin, a safety net)
  const dangerousPatterns = [/rm\s+-rf\s+\/($|\s)/, /:\(\){ :\|: & };:/];
  for (const pattern of dangerousPatterns) {
    if (pattern.test(sanitized)) {
      throw new Error(`Command blocked: Potential system destruction detected.`);
    }
  }

  return sanitized;
}

/**
 * Smart Execution with Auto-Diagnosis
 */
export async function smartExec(command, options = {}) {
  const ctx = getSystemContext();
  const timeout = options.timeout || 60000;
  const maxBuffer = options.maxBuffer || 1024 * 1024 * 5; // 5MB

  try {
    const sanitizedCmd = sanitizeCommand(command);
    logEvent('TERMINAL', `🖥️ [${ctx.platform.toUpperCase()}] Executing: ${sanitizedCmd}`, 'INFO');

    const { stdout, stderr } = await execPromise(sanitizedCmd, {
      timeout,
      maxBuffer,
      env: { ...process.env, ...options.env },
    });

    // If it's a background command, stdout/stderr might be empty but it's fine
    const isBackground = sanitizedCmd.endsWith('&');

    if (stderr && !isBackground) {
      logEvent('TERMINAL', `⚠️ Warning during execution: ${stderr}`, 'WARNING');
    }

    return {
      success: true,
      output:
        stdout ||
        stderr ||
        (isBackground ? 'Process started in background.' : 'Executed successfully.'),
      stderr: stderr || null,
      os: ctx.platform,
    };
  } catch (err) {
    const repairHint = analyzeError(err);
    logEvent('TERMINAL', `🚨 Error detected: ${err.message}`, 'ERROR');

    return {
      success: false,
      error: err.message,
      suggestion: repairHint,
      os: ctx.platform,
      code: err.code,
      killed: err.killed,
    };
  }
}
