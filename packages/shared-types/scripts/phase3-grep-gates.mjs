import { readdir, readFile } from "node:fs/promises"
import { extname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = resolve(scriptPath, "../../../..")
const strictLegacy = process.argv.includes("--strict-legacy")
const sourceExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".mjs",
  ".sol",
  ".ts",
  ".tsx"
])
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "docs",
  "node_modules"
])
const ignoredFiles = new Set([
  relative(repoRoot, scriptPath).replaceAll("\\", "/")
])

const criticalPatterns = [
  "Use different refund wallet",
  "changed_by_user",
  "refundWalletMode",
  "NEXT_PUBLIC_RELAY_API_KEY"
]
const legacyProductPatterns = [
  "Shield | Execute",
  "Execute Status",
  "Private Executions",
  "Request Invoice",
  "Create Invoice Payment"
]

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue
    }

    const fullPath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)))
      continue
    }

    const repoPath = relative(repoRoot, fullPath).replaceAll("\\", "/")
    if (!ignoredFiles.has(repoPath) && sourceExtensions.has(extname(entry.name))) {
      files.push({ fullPath, repoPath })
    }
  }

  return files
}

function collectMatches(content, pattern) {
  return content
    .split(/\r?\n/u)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.includes(pattern))
}

const criticalViolations = []
const unallowlistedLegacyViolations = []
const files = await collectSourceFiles(repoRoot)

for (const { fullPath, repoPath } of files) {
  const content = await readFile(fullPath, "utf8")

  for (const pattern of criticalPatterns) {
    for (const { lineNumber } of collectMatches(content, pattern)) {
      criticalViolations.push(`${repoPath}:${lineNumber} contains forbidden security term "${pattern}"`)
    }
  }

  for (const pattern of legacyProductPatterns) {
    for (const { lineNumber } of collectMatches(content, pattern)) {
      unallowlistedLegacyViolations.push(`${repoPath}:${lineNumber} contains legacy product copy "${pattern}"`)
    }
  }
}

if (unallowlistedLegacyViolations.length > 0) {
  console.error("New or unallowlisted legacy public-copy violations:")
  for (const violation of unallowlistedLegacyViolations) {
    console.error(`- ${violation}`)
  }
}

if (criticalViolations.length > 0) {
  console.error("Phase 3 security grep violations:")
  for (const violation of criticalViolations) {
    console.error(`- ${violation}`)
  }
}

if (
  criticalViolations.length > 0 ||
  unallowlistedLegacyViolations.length > 0 ||
  (strictLegacy && unallowlistedLegacyViolations.length > 0)
) {
  process.exitCode = 1
} else {
  console.log("Phase 3 grep gates passed.")
}
