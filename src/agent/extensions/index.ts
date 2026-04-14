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
  DreamConsolidator,
  MEMORY_TYPES,
  MEMORY_SCOPES,
  MEMORY_SENTIMENTS,
  type MemoryType,
  type MemoryScope,
  type MemorySentiment,
  type MemoryEntry,
  type ConsolidationAction,
} from "../extensions/memorySystem";