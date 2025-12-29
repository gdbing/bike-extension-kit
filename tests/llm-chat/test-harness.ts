type TestFn = () => void | Promise<void>

interface TestCase {
  name: string
  fn: TestFn
}

const tests: TestCase[] = []

export function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

export async function runTests(): Promise<void> {
  let failures = 0

  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`[PASS] ${name}`)
    } catch (error) {
      failures += 1
      console.error(`[FAIL] ${name}`)
      console.error(error)
    }
  }

  if (failures > 0) {
    const message = `${failures} test${failures === 1 ? '' : 's'} failed`
    console.error(message)
    process.exitCode = 1
  } else {
    console.log('All tests passed')
  }
}