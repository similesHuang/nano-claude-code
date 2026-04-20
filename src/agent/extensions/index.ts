// 系统加固层：权限管控、生命周期 Hook、记忆持久化、系统提示词构建

export {
  PermissionManager,
  PERMISSION_MODES,
  type PermissionMode,
  type PermissionDecision,
  type PermissionRule,
} from "../extensions/permissionManager";

export {
  HookManager,
  HOOK_EVENTS,
  type HookEvent,
  type HookResult,
  type HookDefinition,
} from "../extensions/hookManager";

export {
  MemorySystem,
  MEMORY_TYPES,
  MEMORY_SCOPES,
  MEMORY_SENTIMENTS,
  type MemoryType,
  type MemoryScope,
  type MemorySentiment,
  type MemoryEntry,
  
} from "./memorySystem/memorySystem";
export { DreamConsolidator } from "./memorySystem/dreamConsolidator";

export {
  ErrorRecovery,
  chooseRecovery,
  type RecoveryKind,
  type RecoveryDecision,
  type ErrorRecoveryConfig,
} from "../extensions/errorRecovery";

export { SystemPromptBuilder } from "../extensions/systemPromptBuilder";