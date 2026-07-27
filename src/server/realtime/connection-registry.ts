import { HOME_ACCOUNT_REPLACED_EVENT } from './home-events'

export interface RegisteredConnection {
  emit(event: string): void
  disconnect(close?: boolean): void
}

export class ConnectionRegistry {
  private readonly connections = new Map<string, RegisteredConnection>()

  register(accountId: string, connection: RegisteredConnection): void {
    const previous = this.connections.get(accountId)
    this.connections.set(accountId, connection)
    if (!previous || previous === connection) return
    previous.emit(HOME_ACCOUNT_REPLACED_EVENT)
    previous.disconnect(true)
  }

  remove(accountId: string, connection: RegisteredConnection): void {
    if (this.connections.get(accountId) === connection) {
      this.connections.delete(accountId)
    }
  }

  current(accountId: string): RegisteredConnection | null {
    return this.connections.get(accountId) ?? null
  }
}
