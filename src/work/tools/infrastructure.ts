// Infrastructure tools for Kubernetes, databases, and DevOps operations
// Runs commands in a NEW terminal window for interactive use

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import {
  addKnowledge,
  searchKnowledge,
  getKnowledgeByCategory,
  getKnowledgeForPrompt,
  startInfraSession,
  getActiveSessions,
  endInfraSession,
  InfraCategory,
  InfraKnowledge,
} from '../storage/infrastructure.js';

const execAsync = promisify(exec);

// ===== SAFETY =====

// Patterns that indicate mutating operations - BLOCKED
const DANGEROUS_PATTERNS = [
  // Kubernetes mutations
  /kubectl\s+(delete|edit|apply|create|patch|replace|scale|rollout)/i,
  /kubectl\s+.*--force/i,
  /kubectl\s+exec\s+.*--\s*(rm|delete|drop|truncate)/i,
  // Database mutations
  /\b(DELETE|DROP|TRUNCATE|UPDATE|INSERT|ALTER|CREATE|GRANT|REVOKE)\b/i,
  // Teleport mutations
  /tsh\s+(rm|remove|delete)/i,
  // General dangerous commands
  /\brm\s+-rf?\b/i,
  /\bsudo\b/i,
  /\b(shutdown|reboot|halt)\b/i,
  // Helm mutations
  /helm\s+(install|upgrade|delete|uninstall|rollback)/i,
];

// Commands that are explicitly safe (read-only)
const SAFE_COMMAND_PATTERNS = [
  /^tsh\s+(kube\s+ls|kube\s+login|db\s+ls|db\s+login|proxy\s+db)/,
  /^kubectl\s+(get|describe|logs|top|config)/,
  /^kubectl\s+port-forward/,
  /^kubectl\s+.*\|\s*grep/,  // piped to grep is safe
];

function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
  // Check if explicitly safe first
  for (const safePattern of SAFE_COMMAND_PATTERNS) {
    if (safePattern.test(command)) {
      return { dangerous: false };
    }
  }
  
  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        dangerous: true,
        reason: `Command contains potentially mutating operation: ${pattern.toString()}`,
      };
    }
  }
  
  return { dangerous: false };
}

// ===== TERMINAL CONTROL =====

/**
 * Open a new Terminal window on macOS and run a command
 * The terminal stays open for user interaction
 */
export async function openTerminalWithCommand(
  command: string,
  options?: {
    title?: string;
    waitForCompletion?: boolean;
    directory?: string;
  }
): Promise<{
  success: boolean;
  error?: string;
  terminalId?: string;
}> {
  // Safety check
  const safety = isDangerousCommand(command);
  if (safety.dangerous) {
    return {
      success: false,
      error: `🚫 BLOCKED: This command appears to mutate state.\n${safety.reason}\n\nI can only run read-only commands. If you need to run this command, please do so manually.`,
    };
  }
  
  const terminalId = `term_${Date.now()}`;
  const title = options?.title || 'HN Assistant - Infrastructure';
  
  // Build the command with optional cd
  let fullCommand = command;
  if (options?.directory) {
    fullCommand = `cd "${options.directory}" && ${command}`;
  }
  
  // Escape for AppleScript
  const escapedCommand = fullCommand.replace(/"/g, '\\"').replace(/'/g, "'\\''");
  const escapedTitle = title.replace(/"/g, '\\"');
  
  // AppleScript to open new Terminal window
  const appleScript = `
    tell application "Terminal"
      activate
      set newWindow to do script "${escapedCommand}"
      set custom title of front window to "${escapedTitle}"
    end tell
  `;
  
  try {
    await execAsync(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`);
    return {
      success: true,
      terminalId,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to open terminal: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Run a command and capture output (for non-interactive commands)
 * This runs in the background and returns output
 */
export async function runInfraCommand(
  command: string,
  options?: {
    timeout?: number;  // Default 30s
    directory?: string;
  }
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}> {
  // Safety check
  const safety = isDangerousCommand(command);
  if (safety.dangerous) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      exitCode: 1,
      error: `🚫 BLOCKED: ${safety.reason}`,
    };
  }
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: options?.directory,
      timeout: options?.timeout || 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    
    return {
      success: true,
      stdout,
      stderr,
      exitCode: 0,
    };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      success: false,
      stdout: execError.stdout || '',
      stderr: execError.stderr || (error instanceof Error ? error.message : 'Unknown error'),
      exitCode: execError.code || 1,
    };
  }
}

// ===== TSH COMMANDS =====

/**
 * List available Kubernetes environments
 */
export async function listKubeEnvironments(): Promise<{
  success: boolean;
  environments?: string[];
  error?: string;
  needsLogin?: boolean;
}> {
  const result = await runInfraCommand('tsh kube ls', { timeout: 60000 });
  
  if (!result.success) {
    // Check if needs login
    if (result.stderr.includes('login') || result.stderr.includes('expired')) {
      return {
        success: false,
        needsLogin: true,
        error: 'You need to login to Teleport first. I\'ll open a terminal for you to login.',
      };
    }
    return {
      success: false,
      error: result.stderr || result.error,
    };
  }
  
  // Parse the output - typically "Kube Cluster Labels..."
  const lines = result.stdout.split('\n').filter(l => l.trim() && !l.startsWith('Kube Cluster'));
  const environments = lines
    .map(l => l.split(/\s+/)[0])
    .filter(Boolean);
  
  return {
    success: true,
    environments,
  };
}

/**
 * Login to a Kubernetes environment (opens terminal for interactive login)
 */
export async function loginToKubeEnv(
  environment: string
): Promise<{ success: boolean; error?: string }> {
  return openTerminalWithCommand(
    `tsh kube login ${environment}`,
    { title: `K8s Login: ${environment}` }
  );
}

/**
 * Search for databases
 */
export async function searchDatabases(
  query: string
): Promise<{
  success: boolean;
  databases?: Array<{ name: string; description?: string }>;
  error?: string;
  needsLogin?: boolean;
}> {
  const result = await runInfraCommand(`tsh db ls --search ${query}`, { timeout: 60000 });
  
  if (!result.success) {
    if (result.stderr.includes('login') || result.stderr.includes('expired')) {
      return {
        success: false,
        needsLogin: true,
        error: 'You need to login to Teleport first.',
      };
    }
    return {
      success: false,
      error: result.stderr || result.error,
    };
  }
  
  // Parse database list
  const lines = result.stdout.split('\n').filter(l => l.trim() && !l.startsWith('Name'));
  const databases = lines.map(l => {
    const parts = l.split(/\s+/);
    return {
      name: parts[0],
      description: parts.slice(1).join(' ') || undefined,
    };
  }).filter(d => d.name);
  
  return {
    success: true,
    databases,
  };
}

/**
 * Login to a database and proxy it
 */
export async function proxyDatabase(
  database: string,
  options: {
    dbUser: string;
    dbName: string;
    port?: number;
  }
): Promise<{
  success: boolean;
  port?: number;
  sessionId?: string;
  error?: string;
}> {
  const port = options.port || Math.floor(Math.random() * 10000) + 50000; // Random high port
  
  // First login to the database
  const loginCommand = `tsh db login ${database} --db-user ${options.dbUser} --db-name ${options.dbName}`;
  
  // Then proxy it - this needs to run in a terminal as it's long-running
  const proxyCommand = `${loginCommand} && echo "✅ Logged in! Starting proxy on port ${port}..." && tsh proxy db ${database} --port=${port}`;
  
  const result = await openTerminalWithCommand(proxyCommand, {
    title: `DB Proxy: ${database} (port ${port})`,
  });
  
  if (result.success) {
    // Track the session
    const session = await startInfraSession('database', {
      database,
      port,
    }, result.terminalId);
    
    return {
      success: true,
      port,
      sessionId: session.id,
    };
  }
  
  return {
    success: false,
    error: result.error,
  };
}

// ===== KUBECTL COMMANDS =====

/**
 * Get pods in a namespace
 */
export async function getPods(
  namespace: string,
  filter?: string
): Promise<{
  success: boolean;
  pods?: Array<{ name: string; status: string; ready: string; age: string }>;
  error?: string;
}> {
  let command = `kubectl get pods -n ${namespace}`;
  if (filter) {
    command += ` | grep ${filter}`;
  }
  
  const result = await runInfraCommand(command);
  
  if (!result.success) {
    return {
      success: false,
      error: result.stderr || result.error,
    };
  }
  
  // Parse pod list
  const lines = result.stdout.split('\n').filter(l => l.trim() && !l.startsWith('NAME'));
  const pods = lines.map(l => {
    const parts = l.split(/\s+/);
    return {
      name: parts[0],
      ready: parts[1] || '',
      status: parts[2] || '',
      age: parts[4] || parts[3] || '',
    };
  }).filter(p => p.name);
  
  return {
    success: true,
    pods,
  };
}

/**
 * Port forward to a pod (opens terminal)
 */
export async function portForwardPod(
  pod: string,
  ports: string,  // e.g., "8080:8080"
  namespace: string = 'default'
): Promise<{
  success: boolean;
  sessionId?: string;
  error?: string;
}> {
  const command = `kubectl port-forward pod/${pod} ${ports} -n ${namespace}`;
  
  const result = await openTerminalWithCommand(command, {
    title: `Port Forward: ${pod} (${ports})`,
  });
  
  if (result.success) {
    const [localPort] = ports.split(':');
    const session = await startInfraSession('port-forward', {
      pod,
      port: parseInt(localPort),
      namespace,
    }, result.terminalId);
    
    return {
      success: true,
      sessionId: session.id,
    };
  }
  
  return {
    success: false,
    error: result.error,
  };
}

/**
 * Get pod logs
 */
export async function getPodLogs(
  pod: string,
  namespace: string = 'default',
  options?: {
    lines?: number;
    follow?: boolean;  // If true, opens in terminal
    container?: string;
  }
): Promise<{
  success: boolean;
  logs?: string;
  error?: string;
}> {
  let command = `kubectl logs ${pod} -n ${namespace}`;
  if (options?.container) {
    command += ` -c ${options.container}`;
  }
  if (options?.lines) {
    command += ` --tail=${options.lines}`;
  }
  
  if (options?.follow) {
    // Open in terminal for following
    command += ' -f';
    const result = await openTerminalWithCommand(command, {
      title: `Logs: ${pod}`,
    });
    return {
      success: result.success,
      logs: result.success ? 'Following logs in new terminal window...' : undefined,
      error: result.error,
    };
  }
  
  const result = await runInfraCommand(command, { timeout: 60000 });
  return {
    success: result.success,
    logs: result.stdout,
    error: result.stderr || result.error,
  };
}

/**
 * Describe a pod
 */
export async function describePod(
  pod: string,
  namespace: string = 'default'
): Promise<{
  success: boolean;
  description?: string;
  error?: string;
}> {
  const result = await runInfraCommand(`kubectl describe pod ${pod} -n ${namespace}`);
  return {
    success: result.success,
    description: result.stdout,
    error: result.stderr || result.error,
  };
}

// ===== KNOWLEDGE MANAGEMENT =====

/**
 * Remember a command or piece of infrastructure knowledge
 */
export async function rememberInfraKnowledge(
  category: InfraCategory,
  key: string,
  content: string,
  options?: {
    context?: string;
    examples?: string[];
  }
): Promise<InfraKnowledge> {
  return addKnowledge(category, key, content, {
    ...options,
    learnedFrom: 'user taught',
  });
}

/**
 * Search for remembered knowledge
 */
export async function findKnowledge(query: string): Promise<InfraKnowledge[]> {
  return searchKnowledge(query);
}

/**
 * Get all knowledge of a specific type
 */
export async function getKnowledgeOfType(category: InfraCategory): Promise<InfraKnowledge[]> {
  return getKnowledgeByCategory(category);
}

// Re-export for convenience
export {
  getKnowledgeForPrompt,
  getActiveSessions,
  endInfraSession,
};
export type { InfraCategory } from '../storage/infrastructure.js';

// ===== HELPER FUNCTIONS =====

/**
 * Check if tsh is available and user is logged in
 */
export async function checkTshStatus(): Promise<{
  available: boolean;
  loggedIn: boolean;
  error?: string;
}> {
  // Check if tsh exists
  const whichResult = await runInfraCommand('which tsh');
  if (!whichResult.success) {
    return {
      available: false,
      loggedIn: false,
      error: 'tsh command not found. Please install Teleport.',
    };
  }
  
  // Check login status
  const statusResult = await runInfraCommand('tsh status', { timeout: 10000 });
  if (!statusResult.success || statusResult.stderr.includes('not logged in')) {
    return {
      available: true,
      loggedIn: false,
      error: 'Not logged in to Teleport.',
    };
  }
  
  return {
    available: true,
    loggedIn: true,
  };
}

/**
 * Check if kubectl is configured for current context
 */
export async function checkKubectlStatus(): Promise<{
  available: boolean;
  currentContext?: string;
  error?: string;
}> {
  const whichResult = await runInfraCommand('which kubectl');
  if (!whichResult.success) {
    return {
      available: false,
      error: 'kubectl command not found.',
    };
  }
  
  const contextResult = await runInfraCommand('kubectl config current-context');
  if (!contextResult.success) {
    return {
      available: true,
      error: 'kubectl available but no context set.',
    };
  }
  
  return {
    available: true,
    currentContext: contextResult.stdout.trim(),
  };
}

/**
 * Open a terminal for Teleport login
 */
export async function openTshLogin(): Promise<{ success: boolean; error?: string }> {
  return openTerminalWithCommand('tsh login', { title: 'Teleport Login' });
}

