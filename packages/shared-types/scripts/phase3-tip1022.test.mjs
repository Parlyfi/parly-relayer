import assert from "node:assert/strict"
import test from "node:test"

import {
  assertTip1022VirtualAddressBinding,
  decodeTip1022VirtualAddress,
  deriveTip1022VirtualAddress
} from "../dist/index.js"

test("TIP-1022 virtual address derives from 4-byte master id and 6-byte user tag", () => {
  const address = deriveTip1022VirtualAddress("0xc1231aa2", "0x010203040506")

  assert.equal(address, "0xc1231aa2fdfdfdfdfdfdfdfdfdfd010203040506")
  assert.deepEqual(decodeTip1022VirtualAddress(address), {
    masterId: "0xc1231aa2",
    userTag: "0x010203040506"
  })
})

test("TIP-1022 binding rejects wrong master id and malformed values", () => {
  const address = deriveTip1022VirtualAddress("0xc1231aa2", "0x010203040506")

  assert.deepEqual(assertTip1022VirtualAddressBinding({ address, expectedMasterId: "0xc1231aa2" }), {
    masterId: "0xc1231aa2",
    userTag: "0x010203040506"
  })
  assert.throws(
    () => assertTip1022VirtualAddressBinding({ address, expectedMasterId: "0x99999999" }),
    /master ID mismatch/u
  )
  assert.throws(() => deriveTip1022VirtualAddress("0x1234", "0x010203040506"), /4-byte hex value/u)
  assert.throws(() => deriveTip1022VirtualAddress("0xc1231aa2", "0x0102"), /6-byte hex value/u)
})
