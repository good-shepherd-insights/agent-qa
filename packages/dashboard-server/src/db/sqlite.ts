import {
  DatabaseSync,
  type SQLInputValue,
  type StatementResultingChanges,
  type StatementSync,
} from 'node:sqlite'

export interface DashboardSqliteStatement {
  all(...parameters: unknown[]): unknown[]
  get(...parameters: unknown[]): unknown
  run(...parameters: unknown[]): StatementResultingChanges
}

export interface DashboardSqliteDatabase {
  close(): void
  exec(sql: string): void
  prepare(sql: string): DashboardSqliteStatement
  pragma(source: string, options?: { simple?: boolean }): unknown
  transaction<T>(operation: () => T, options?: { immediate?: boolean }): () => T
}

function bind(parameters: unknown[]): SQLInputValue[] {
  return parameters as SQLInputValue[]
}

function wrapStatement(statement: StatementSync): DashboardSqliteStatement {
  return {
    all: (...parameters) => statement.all(...bind(parameters)),
    get: (...parameters) => statement.get(...bind(parameters)),
    run: (...parameters) => statement.run(...bind(parameters)),
  }
}

class NodeSqliteDatabase implements DashboardSqliteDatabase {
  readonly #database: DatabaseSync
  #closed = false

  constructor(path: string) {
    this.#database = new DatabaseSync(path)
  }

  close(): void {
    if (this.#closed) return
    this.#database.close()
    this.#closed = true
  }

  exec(sql: string): void {
    this.#database.exec(sql)
  }

  prepare(sql: string): DashboardSqliteStatement {
    return wrapStatement(this.#database.prepare(sql))
  }

  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.#database.prepare(`PRAGMA ${source}`).all()
    if (!options.simple) return rows

    const firstRow = rows[0]
    return firstRow ? Object.values(firstRow)[0] : undefined
  }

  transaction<T>(operation: () => T, options: { immediate?: boolean } = {}): () => T {
    const begin = options.immediate ? 'BEGIN IMMEDIATE' : 'BEGIN'
    return () => {
      this.#database.exec(begin)
      try {
        const result = operation()
        this.#database.exec('COMMIT')
        return result
      } catch (error) {
        try {
          this.#database.exec('ROLLBACK')
        } catch {
          // Preserve the operation error if rollback cannot run.
        }
        throw error
      }
    }
  }
}

export function createDashboardSqliteDatabase(path: string): DashboardSqliteDatabase {
  return new NodeSqliteDatabase(path)
}
