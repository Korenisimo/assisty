// Shell and file system tools for the agent
// The agent's workspace is always WORK_DIRS/

import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, writeFile, readFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { ShellService } from '../../utils/platform/index.js';

const execAsync = promisify(exec);

// Get the workspace root (WORK_DIRS in cwd)
export function getWorkspace(): string {
  return join(process.cwd(), 'WORK_DIRS');
}

// Ensure a path is within the workspace
function ensureInWorkspace(path: string): string {
  const workspace = getWorkspace();
  const resolved = resolve(workspace, path);
  
  if (!resolved.startsWith(workspace)) {
    throw new Error(`Path must be within WORK_DIRS: ${path}`);
  }
  
  return resolved;
}

// Execute a shell command in the workspace
export async function runShellCommand(
  command: string,
  workingDir?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const workspace = getWorkspace();
  
  // Ensure WORK_DIRS exists
  if (!existsSync(workspace)) {
    await mkdir(workspace, { recursive: true });
  }
  
  // Determine working directory
  let cwd = workspace;
  if (workingDir) {
    cwd = ensureInWorkspace(workingDir);
    if (!existsSync(cwd)) {
      await mkdir(cwd, { recursive: true });
    }
  }
  
  try {
    // Use platform-appropriate shell via ShellService
    const shellOptions = ShellService.getExecOptions();
    
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 120000, // 2 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      ...shellOptions,
    });
    
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || (error instanceof Error ? error.message : 'Unknown error'),
      exitCode: execError.code || 1,
    };
  }
}

// Create a directory in the workspace
export async function createDirectory(path: string): Promise<string> {
  const fullPath = ensureInWorkspace(path);
  await mkdir(fullPath, { recursive: true });
  return fullPath;
}

// Write a file in the workspace
export async function writeWorkspaceFile(
  path: string,
  content: string
): Promise<string> {
  const fullPath = ensureInWorkspace(path);
  
  // Ensure parent directory exists (use platform-aware separator)
  const lastSepIndex = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
  const parentDir = fullPath.substring(0, lastSepIndex);
  if (parentDir && !existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }
  
  await writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

// Read a file from the workspace
export async function readWorkspaceFile(path: string): Promise<string> {
  const fullPath = ensureInWorkspace(path);
  return readFile(fullPath, 'utf-8');
}

// List directory contents in the workspace
export async function listDirectory(path: string = ''): Promise<{
  name: string;
  type: 'file' | 'directory';
  size?: number;
}[]> {
  const fullPath = path ? ensureInWorkspace(path) : getWorkspace();
  
  if (!existsSync(fullPath)) {
    return [];
  }
  
  const entries = await readdir(fullPath, { withFileTypes: true });
  const results = [];
  
  for (const entry of entries) {
    const entryPath = join(fullPath, entry.name);
    const stats = await stat(entryPath);
    
    results.push({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' as const : 'file' as const,
      size: entry.isFile() ? stats.size : undefined,
    });
  }
  
  return results;
}

// Check if path exists in workspace
export async function pathExists(path: string): Promise<boolean> {
  try {
    const fullPath = ensureInWorkspace(path);
    return existsSync(fullPath);
  } catch {
    return false;
  }
}

