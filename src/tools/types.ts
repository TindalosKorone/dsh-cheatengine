import type { CEClient } from '../ce-client.js'

export interface ToolDef {
  name: string
  description: string
  parameters?: Record<string, any>
  method: string
  mapParams?: (args: any) => Record<string, any>
  mapResult?: (result: any, args: any) => any
  execute?: (args: any, client: CEClient) => Promise<any>
  dangerous?: boolean
  kind?: 'search'
}
