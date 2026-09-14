export const TEMPO_TIP1022_ADDRESS_REGISTRY = "0xfdc0000000000000000000000000000000000000"
export const TIP1022_VIRTUAL_ADDRESS_MAGIC = "fdfdfdfdfdfdfdfdfdfd"

const MASTER_ID_RE = /^0x[a-fA-F0-9]{8}$/u
const USER_TAG_RE = /^0x[a-fA-F0-9]{12}$/u
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/u

export function requireTip1022MasterId(masterId) {
  if (!MASTER_ID_RE.test(masterId)) {
    throw new Error("TIP-1022 master ID must be a 4-byte hex value")
  }
  return masterId.toLowerCase()
}

export function requireTip1022UserTag(userTag) {
  if (!USER_TAG_RE.test(userTag)) {
    throw new Error("TIP-1022 user tag must be a 6-byte hex value")
  }
  return userTag.toLowerCase()
}

export function deriveTip1022VirtualAddress(masterId, userTag) {
  return `0x${requireTip1022MasterId(masterId).slice(2)}${TIP1022_VIRTUAL_ADDRESS_MAGIC}${requireTip1022UserTag(userTag).slice(2)}`
}

export function decodeTip1022VirtualAddress(address) {
  if (!ADDRESS_RE.test(address)) {
    throw new Error("TIP-1022 virtual address must be a 20-byte hex address")
  }
  const normalized = address.toLowerCase()
  const magic = normalized.slice(10, 30)
  if (magic !== TIP1022_VIRTUAL_ADDRESS_MAGIC) {
    throw new Error("TIP-1022 virtual address magic mismatch")
  }
  return {
    masterId: `0x${normalized.slice(2, 10)}`,
    userTag: `0x${normalized.slice(30, 42)}`
  }
}

export function assertTip1022VirtualAddressBinding(args) {
  const decoded = decodeTip1022VirtualAddress(args.address)
  if (decoded.masterId !== requireTip1022MasterId(args.expectedMasterId)) {
    throw new Error("TIP-1022 master ID mismatch")
  }
  if (args.expectedUserTag && decoded.userTag !== requireTip1022UserTag(args.expectedUserTag)) {
    throw new Error("TIP-1022 user tag mismatch")
  }
  return decoded
}

export function isTip1022VirtualAddress(address) {
  try {
    decodeTip1022VirtualAddress(address)
    return true
  } catch {
    return false
  }
}
