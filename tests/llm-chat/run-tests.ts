import { runTests } from './test-harness'

import './message-parser.test'
import './response-inserter.test'
import './settings-parser.test'

runTests().catch(error => {
  console.error('Test runner encountered an unexpected error')
  console.error(error)
  process.exitCode = 1
})
