import type { CEClient } from '../ce-client.js'
import { analyzeDefs, analyzePointerDefs } from './analyze.js'
import { caseBudgetDefs, caseEvidenceDefs, caseReportDefs, caseSessionDefs, caseStatsDefs } from './case.js'
import { debugDefs, debugExtraDefs } from './debug.js'
import { createResidentDefs, missionDefs, playbookDefs } from './guide.js'
import { lockDefs } from './lock.js'
import { memoryManyDefs, memoryReadDefs, memoryUnifiedDefs, memoryWriteDefs } from './memory.js'
import { processDefs, processExtraDefs } from './process.js'
import { scanDefs, scanExtraDefs } from './scan.js'
import { scriptDefs, scriptInstallDefs } from './script.js'
import { searchDefs } from './search.js'
import type { ToolDef } from './types.js'

export type { ToolDef } from './types.js'

/**
 * Build all tool definitions.
 *
 * The segment order intentionally mirrors the original monolithic array order
 * in src/index.ts so registration and catalog ordering are unchanged.
 */
export function createToolDefs(client: CEClient): ToolDef[] {
  return [
    ...createResidentDefs(client),
    ...processDefs,
    ...scanDefs,
    ...memoryReadDefs,
    ...memoryWriteDefs,
    ...debugDefs,
    ...scriptDefs,
    ...debugExtraDefs,
    ...lockDefs,
    ...analyzePointerDefs,
    ...processExtraDefs,
    ...scriptInstallDefs,
    ...caseStatsDefs,
    ...scanExtraDefs,
    ...memoryManyDefs,
    ...caseBudgetDefs,
    ...playbookDefs,
    ...caseEvidenceDefs,
    ...analyzeDefs,
    ...missionDefs,
    ...caseReportDefs,
    ...memoryUnifiedDefs,
    ...caseSessionDefs,
    ...searchDefs,
  ]
}
