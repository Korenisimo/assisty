// Work mode main entry point

export { WorkInput, WorkSession, RelevantData, PersonalityType, PersonalityConfig, CharacterType, CharacterConfig } from './types.js';
export { runWorkAgent, WorkAgentSession, getWorkspace, AgentChecklist } from './agent.js';
export { createWorkSession, saveResults, listWorkSessions } from './storage.js';
export {
  isJiraConfigured,
  getJiraConfigStatus,
  isConfluenceConfigured,
  isFireHydrantConfigured,
  isDatadogConfigured,
  isGitHubConfigured,
  getGitHubConfigStatus,
} from './clients/index.js';

// Memory system
export {
  Memory,
  PendingMemory,
  getMemories,
  getPendingMemories,
  approveMemory,
  rejectMemory,
  deleteMemory,
  clearAllMemories,
} from './tools/memory.js';

// Character system
export {
  CustomCharacter,
  getCustomCharacters,
  getCharacterById,
  getCharacterByName,
  saveCharacter,
  deleteCharacter,
} from './storage/characters.js';

// Session preferences
export {
  SessionPreferences,
  getSessionPreferences,
  setPersonalityPreference,
  setCharacterPreference,
  setDatadogPreference,
} from './storage/preferences.js';

// Infrastructure system
export {
  InfraKnowledge,
  InfraSession,
  InfraCategory,
  getInfraKnowledge,
  getKnowledgeByCategory,
  searchKnowledge,
  addKnowledge,
  deleteKnowledge,
  getActiveSessions,
  clearStaleSessions,
} from './storage/infrastructure.js';

// Project knowledge system
export {
  ProjectKnowledge,
  ProjectCategory,
  getAllProjectKnowledge,
  getProjectKnowledge,
  searchProjectKnowledge,
  addProjectKnowledge,
  deleteProjectKnowledge,
  listKnownProjects,
} from './storage/projects.js';

// Checkpoint system
export {
  Checkpoint,
  saveCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  deleteCheckpoint,
  deserializeMessages,
} from './storage/checkpoints.js';
