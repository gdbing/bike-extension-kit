declare module 'node:assert/strict' {
  export function equal(actual: unknown, expected: unknown, message?: string): void
  export function deepEqual(actual: unknown, expected: unknown, message?: string): void
  export function strictEqual(actual: unknown, expected: unknown, message?: string): void
  export function notEqual(actual: unknown, expected: unknown, message?: string): void
  export function ok(value: unknown, message?: string): asserts value
  export function match(value: unknown, regexp: RegExp, message?: string): void
  export function throws(block: () => unknown, error?: unknown, message?: string): void
}

declare module 'node:fs' {
  export function copyFileSync(src: string, dest: string): void
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean }
  ): void
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string
  export function dirname(path: string): string
}

interface NodeModule {
  exports: unknown
}

interface NodeRequire {
  (id: string): unknown
  cache: Record<string, NodeModule | undefined>
}

declare const require: NodeRequire
declare const __dirname: string
declare const process: {
  cwd(): string
  exitCode?: number
}
