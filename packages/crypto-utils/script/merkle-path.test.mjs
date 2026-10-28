import assert from "node:assert/strict"
import test from "node:test"

import { buildIndexedMerklePath } from "../dist/index.js"

const hash = (left, right) => left * 1_000_003n + right * 97n + 11n

test("builds an indexed sparse path with the supplied zero table", () => {
  const zeros = [5n]
  for (let level = 1; level < 4; level += 1) {
    zeros.push(hash(zeros[level - 1], zeros[level - 1]))
  }

  const path = buildIndexedMerklePath({
    levels: 4,
    leaves: [
      { index: 0, value: 17n },
      { index: 2, value: 29n }
    ],
    leafIndex: 2,
    zeros,
    hash
  })

  assert.deepEqual(path.pathIndices, [0, 1, 0, 0])
  assert.equal(path.pathElements[0], zeros[0])
  assert.equal(path.pathElements[1], hash(17n, zeros[0]))

  let reconstructed = 29n
  for (let level = 0; level < 4; level += 1) {
    reconstructed = path.pathIndices[level] === 0
      ? hash(reconstructed, path.pathElements[level])
      : hash(path.pathElements[level], reconstructed)
  }
  assert.equal(reconstructed, path.root)
})

test("rejects duplicate leaf indexes", () => {
  assert.throws(
    () => buildIndexedMerklePath({
      levels: 2,
      leaves: [
        { index: 0, value: 1n },
        { index: 0, value: 2n }
      ],
      leafIndex: 0,
      zeros: [0n, 0n],
      hash
    }),
    /duplicate index/u
  )
})
