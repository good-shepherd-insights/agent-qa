import type { z } from 'zod'
import type { Platform, Surface } from '@vostride/agent-qa-schema'
import type { ToolDefinition } from './types.js'

export const EXPOSURE: Record<Platform, ReadonlySet<Surface>> = {
  web: new Set<Surface>(['web', 'common']),
  android: new Set<Surface>(['mobile', 'android', 'common']),
  ios: new Set<Surface>(['mobile', 'ios', 'common']),
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  register<T extends z.ZodType>(def: ToolDefinition<T>): this {
    this.tools.set(def.id, def)
    return this
  }

  get(id: string): ToolDefinition | undefined {
    return this.tools.get(id)
  }

  getAll(): ToolDefinition[] {
    return [...this.tools.values()]
  }

  getForPlatform(platform: Platform): ToolDefinition[] {
    const surfaces = EXPOSURE[platform]
    return this.getAll().filter(def => def.exposed !== false && surfaces.has(def.surface))
  }

  getSchema(id: string): z.ZodType {
    const def = this.tools.get(id)
    if (!def) throw new Error(`Unknown tool: ${id}`)
    return def.schema
  }

  generateDocs(platform?: Platform): string {
    const lines: string[] = []
    const filtered = platform ? this.getForPlatform(platform) : this.getAll()

    for (const def of filtered) {
      const shape = ('shape' in def.schema ? def.schema.shape : undefined) as Record<string, z.ZodType> | undefined
      const params: string[] = []

      if (shape) {
        for (const [fieldName, field] of Object.entries(shape)) {
          const paramDesc = field.description ?? (field as { _def?: { description?: string; innerType?: { description?: string } } })._def?.description ?? (field as { _def?: { innerType?: { description?: string } } })._def?.innerType?.description ?? ''
          params.push(paramDesc ? `${fieldName} (${paramDesc})` : fieldName)
        }
      }

      let line = `- ${def.id}: ${def.description}`
      if (params.length > 0) {
        line += `. Params: ${params.join(', ')}`
      }
      lines.push(line)
    }

    return lines.join('\n')
  }
}

export const defaultRegistry = new ToolRegistry()
