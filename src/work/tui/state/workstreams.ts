// Workstream State Management
// CRUD operations and disk persistence for workstreams

import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Workstream, WorkstreamType, WorkstreamMetadata, WorkstreamStatus } from '../types.js';
import { SerializedMessage } from '../../storage/checkpoints.js';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { getTrashBinManager, TrashedWorkstream } from './trash.js';
import { ensureConfigDir } from '../../../utils/platform.js';

// Storage directory (uses platform-appropriate config directory)
function getWorkstreamsDir(): string {
  return join(ensureConfigDir(), 'workstreams');
}

// Generate unique ID
function generateId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Serialize LangChain messages to storable format
// Uses _getType() instead of instanceof for cross-module safety
export function serializeMessages(messages: BaseMessage[]): SerializedMessage[] {
  return messages.map(msg => {
    const content = typeof msg.content === 'string' 
      ? msg.content 
      : JSON.stringify(msg.content);
    
    const msgType = msg._getType?.();
    
    if (msgType === 'human') {
      return { type: 'human' as const, content };
    } else if (msgType === 'ai') {
      const aiMsg = msg as AIMessage;
      const serialized: SerializedMessage = { type: 'ai' as const, content };
      
      if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
        serialized.toolCalls = aiMsg.tool_calls.map(tc => ({
          name: tc.name,
          args: tc.args as Record<string, unknown>,
          id: tc.id || '',
        }));
      }
      
      return serialized;
    } else if (msgType === 'system') {
      return { type: 'system' as const, content };
    } else if (msgType === 'tool') {
      const toolMsg = msg as ToolMessage;
      return {
        type: 'tool' as const,
        content,
        toolCallId: toolMsg.tool_call_id,
        name: toolMsg.name,
      };
    }
    
    return { type: 'human' as const, content };
  });
}

export class WorkstreamManager {
  private workstreams: Map<string, Workstream> = new Map();
  private loaded: boolean = false;

  async ensureDir(): Promise<void> {
    const dir = getWorkstreamsDir();
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    
    await this.ensureDir();
    const dir = getWorkstreamsDir();
    
    try {
      const files = await readdir(dir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const workstream = JSON.parse(content) as Workstream;
          this.workstreams.set(workstream.id, workstream);
        } catch {
          // Skip invalid files
        }
      }
      
      this.loaded = true;
    } catch {
      this.loaded = true;
    }
  }

  async save(workstream: Workstream): Promise<void> {
    await this.ensureDir();
    const filepath = join(getWorkstreamsDir(), `${workstream.id}.json`);
    await writeFile(filepath, JSON.stringify(workstream, null, 2));
  }

  async create(
    type: WorkstreamType,
    name: string,
    metadata?: WorkstreamMetadata
  ): Promise<Workstream> {
    const workstream: Workstream = {
      id: generateId(),
      name,
      type,
      status: 'waiting',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      tokenEstimate: 0,
      turnCount: 0,
      metadata,
      personality: 'proactive',
      character: 'none',
      datadogEnabled: false,
      // Default model configuration (can be changed later via update())
      modelConfig: {
        standardModel: 'gemini-3-pro-preview',
        externalCommsModel: 'gemini-3-pro-preview',
      },
    };
    
    this.workstreams.set(workstream.id, workstream);
    await this.save(workstream);
    
    return workstream;
  }

  async update(
    id: string,
    updates: Partial<Omit<Workstream, 'id' | 'createdAt'>>
  ): Promise<Workstream | null> {
    const workstream = this.workstreams.get(id);
    if (!workstream) return null;
    
    const updated: Workstream = {
      ...workstream,
      ...updates,
      updatedAt: Date.now(),
    };
    
    this.workstreams.set(id, updated);
    await this.save(updated);
    
    return updated;
  }

  async updateStatus(
    id: string,
    status: WorkstreamStatus,
    statusMessage?: string
  ): Promise<void> {
    await this.update(id, { status, statusMessage });
  }

  /**
   * Soft delete - moves workstream to trash bin
   * Returns the trashed workstream or null if not found
   */
  async delete(id: string, reason?: string): Promise<TrashedWorkstream | null> {
    const workstream = this.workstreams.get(id);
    if (!workstream) return null;
    
    // Move to trash bin
    const trashBin = getTrashBinManager();
    const trashed = await trashBin.moveToTrash(workstream, reason);
    
    // Remove from active workstreams
    this.workstreams.delete(id);
    
    // Remove from disk
    const filepath = join(getWorkstreamsDir(), `${id}.json`);
    try {
      await unlink(filepath);
    } catch {
      // File might not exist
    }
    
    return trashed;
  }

  /**
   * Restore a workstream from the trash bin
   */
  async restoreFromTrash(id: string): Promise<Workstream | null> {
    const trashBin = getTrashBinManager();
    const restored = await trashBin.restore(id);
    
    if (!restored) return null;
    
    // Add back to active workstreams
    this.workstreams.set(restored.id, restored);
    await this.save(restored);
    
    return restored;
  }

  /**
   * Permanently delete a workstream from trash (no recovery)
   */
  async permanentlyDelete(id: string): Promise<boolean> {
    const trashBin = getTrashBinManager();
    return trashBin.permanentlyDelete(id);
  }

  get(id: string): Workstream | undefined {
    return this.workstreams.get(id);
  }

  getAll(): Workstream[] {
    // Sort by createdAt so numbering stays stable
    return Array.from(this.workstreams.values())
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getByType(type: WorkstreamType): Workstream[] {
    return this.getAll().filter(w => w.type === type);
  }

  getByStatus(status: WorkstreamStatus): Workstream[] {
    return this.getAll().filter(w => w.status === status);
  }

  getNeedingAttention(): Workstream[] {
    return this.getAll().filter(w => 
      w.status === 'needs_input' || w.status === 'error'
    );
  }

  getActive(): Workstream[] {
    return this.getAll().filter(w => 
      w.status !== 'done' && w.status !== 'error'
    );
  }
}

