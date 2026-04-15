/**
 * Centralized dangerous pattern definitions for sandbox security.
 * Used across:
 * - executor.ts (path traversal prevention)
 * - bash.ts (shell command denial)
 * - approval.ts (approval gating for dangerous operations)
 */

/**
 * Dangerous shell command patterns that are always denied.
 * Used by: bash.ts, approval.ts
 */
export const SHELL_COMMAND_PATTERNS: RegExp[] = [
  /^\s*rm\s+-rf/i,
  /^\s*git\s+push\s+--force/i,
  /^\s*git\s+push\s+-f/i,
  /^\s*dd\s+/i,
  /^\s*mkfs/i,
  /^\s*fdisk/i,
  /^\s*drop\s+(table|database)/i,
  /^\s*shutdown/i,
  /^\s*reboot/i,
  /^\s*sudo\s+su/i,
  /^\s*chmod\s+-R\s+777/i,
  /^\s*curl\b[^\n]*\|\s*sh\b/i,
  /^\s*wget\b[^\n]*\|\s*sh\b/i,
];

/**
 * Sensitive file paths that should require approval when accessed.
 * Used by: approval.ts
 */
export const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /^\/etc\//i,
  /^\/usr\/(?:bin|sbin|local\/bin)/i,
  /^\/var\/log\//i,
  /^\/root\//i,
  /^(?:\.ssh\/|\/\.ssh\/)/i,
  /^(?:\.aws\/|\/\.aws\/)/i,
  /^\/tmp\/.*\.sh$/i,
];

/**
 * Patterns that prevent directory/path traversal in executor.
 * Used by: executor.ts (resolve_path checks)
 */
export const PATH_TRAVERSAL_PATTERNS: RegExp[] = [
  /^\s*cd\s+\.\./,           // Upward directory traversal
  /~\//,                      // Home directory access
  /\/etc\//,                  // System configuration
  /\/proc\//,                 // Process information
  /\/sys\//,                  // Kernel information
];

/**
 * Check if a shell command matches any dangerous pattern.
 */
export function is_dangerous_command(command: string): boolean {
  return SHELL_COMMAND_PATTERNS.some((pattern) => pattern.test(command.trim()));
}

/**
 * Check if a file path is sensitive and requires approval.
 */
export function is_sensitive_path(path: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Check if a path traversal pattern is detected.
 */
export function has_path_traversal_attempt(path_or_command: string): boolean {
  return PATH_TRAVERSAL_PATTERNS.some((pattern) => pattern.test(path_or_command));
}
