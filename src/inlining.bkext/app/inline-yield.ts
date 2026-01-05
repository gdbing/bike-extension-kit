import { BACKGROUND_SLICE_ROWS } from './inline-constants'

export class YieldController {
  private rowCount = 0

  async maybeYield(): Promise<void> {
    this.rowCount += 1
    if (this.rowCount < BACKGROUND_SLICE_ROWS) return
    this.rowCount = 0
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}
