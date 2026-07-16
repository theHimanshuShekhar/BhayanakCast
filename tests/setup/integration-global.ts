import { randomUUID } from 'node:crypto'
import { createRsbuild } from '@rsbuild/core'
import rsbuildConfig from '../../rsbuild.config'

export default async function setup() {
  process.env.TEST_RUN_ID = randomUUID()
  const rsbuild = await createRsbuild({ rsbuildConfig })
  await rsbuild.build()
}
