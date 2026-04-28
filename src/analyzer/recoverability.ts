// Re-export recoverability utilities from the resource registry
// This file exists for organizational purposes and potential future expansion

export { getRecoverability, getHandler, isResourceTypeSupported } from '../resources/index.js';
export { RecoverabilityTier, RecoverabilityLabels } from '../resources/types.js';
export type { RecoverabilityResult } from '../resources/types.js';
