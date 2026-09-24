export const CRITICAL_STRUCTURE_FLAGS = Object.freeze([
  'MINT_AUTHORITY_ACTIVE',
  'FREEZE_AUTHORITY_ACTIVE',
  'PERMANENT_DELEGATE_ACTIVE',
  'DEFAULT_ACCOUNT_FROZEN',
  'NON_TRANSFERABLE_TOKEN',
  'TOKEN_PAUSED',
  'EXTERNAL_RUGGED',
  'EXTERNAL_STRUCTURAL_DANGER',
  'EVM_NO_CONTRACT_CODE',
  'EVM_CANNOT_BUY',
  'EXTREME_OWNER_CONCENTRATION',
  'EXTREME_EXTERNAL_CONCENTRATION',
])

const CRITICAL_SET=new Set(CRITICAL_STRUCTURE_FLAGS)

export function criticalStructureFlags(value){
  const flags=Array.isArray(value)
    ? value
    : Array.isArray(value?.intelligence?.riskFlags)
      ? value.intelligence.riskFlags
      : Array.isArray(value?.riskFlags)
        ? value.riskFlags
        : []
  return flags.filter((flag)=>CRITICAL_SET.has(String(flag)))
}
