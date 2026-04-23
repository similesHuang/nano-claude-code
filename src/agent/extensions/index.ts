// 运行时核心子系统：技能发现、上下文压缩、权限、钩子、记忆、错误恢复

export { SkillsSystem, type SkillManifest } from "./skill";
export { CompactSystem } from "./compact";
export { PermissionManager, PERMISSION_MODES, type PermissionMode, type PermissionDecision, type PermissionRule } from "./permission";
export { HookManager, HOOK_EVENTS, type HookEvent, type HookResult, type HookDefinition } from "./hooks";
export { MemorySystem, MEMORY_TYPES, MEMORY_SCOPES, MEMORY_SENTIMENTS, type MemoryType, type MemoryScope, type MemorySentiment, type MemoryEntry } from "./memory";
export { DreamConsolidator } from "./memory/dreamConsolidator";
export { ErrorRecovery, chooseRecovery, type RecoveryKind, type RecoveryDecision, type ErrorRecoveryConfig } from "./retry";
export { SystemPromptBuilder } from "./promptBuilder";