import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, statSync, readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const backendDirectory = resolve(scriptDirectory, '..')
const testsDirectory = join(backendDirectory, 'supabase', 'tests')
const require = createRequire(import.meta.url)
const supabasePackageDirectory = dirname(require.resolve('supabase/package.json'))
const supabaseCli = join(supabasePackageDirectory, 'dist', 'supabase.js')

function collectSqlTests(target) {
  if (!existsSync(target)) {
    throw new Error(`Database test path does not exist: ${target}`)
  }

  if (statSync(target).isDirectory()) {
    return readdirSync(target, { withFileTypes: true })
      .flatMap((entry) => collectSqlTests(join(target, entry.name)))
  }

  return target.endsWith('.test.sql') ? [target] : []
}

function resolveTestTarget(argument) {
  const directPath = resolve(backendDirectory, argument)

  if (existsSync(directPath)) {
    return directPath
  }

  return resolve(testsDirectory, argument)
}

const requestedTargets = process.argv.slice(2)
let previewMigration = null
if (requestedTargets[0] === '--preview-migration') {
  // One migration, or several separated by commas, applied in the given order.
  const migrationNames = (requestedTargets[1] ?? '').split(',')
  if (migrationNames.some((name) => !/^\d{14}_[a-z0-9_]+\.sql$/u.test(name)) || requestedTargets.length < 3) {
    throw new Error('Preview requires migration filenames (comma-separated) and explicit test filenames')
  }
  previewMigration = migrationNames
    .map((name) => transactionBody(readFileSync(join(backendDirectory, 'supabase', 'migrations', name), 'utf8'), 'commit'))
    .join('\n')
  requestedTargets.splice(0, 2)
  console.log('Preview: pending SQL and test fixtures run inside BEGIN / ROLLBACK; migration history is not changed.')
}

// Only explicitly transaction-wrapped files can be mechanically combined for a
// rollback-only rehearsal. Never forward their COMMIT to the linked project.
function transactionBody(sql, end) {
  const begins = sql.match(/^begin;\s*$/gimu) ?? []
  const commits = sql.match(/^commit;\s*$/gimu) ?? []
  const rollbacks = sql.match(/^rollback;\s*$/gimu) ?? []
  if (begins.length !== 1 || commits.length !== (end === 'commit' ? 1 : 0)
    || rollbacks.length !== (end === 'rollback' ? 1 : 0)
    || !(new RegExp(`${end};\\s*$`, 'iu')).test(sql)) {
    throw new Error('Preview requires exactly one outer BEGIN and final COMMIT/ROLLBACK')
  }
  const body = sql.replace(/^begin;\s*$/imu, '').replace(new RegExp(`${end};\\s*$`, 'iu'), '')
  const commands = body
    .replace(/\$([A-Za-z_][\w]*|)\$[\s\S]*?\$\1\$/gu, ' ')
    .replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\//gu, ' ')
  if (/(?:^|;)\s*(?:begin|commit|rollback|end|start\s+transaction|prepare\s+transaction|savepoint|release)\b/iu.test(commands)) {
    throw new Error('Preview refuses embedded transaction-control statements')
  }
  return body
}
const targets = requestedTargets.length > 0
  ? requestedTargets.map(resolveTestTarget)
  : [testsDirectory]
const testFiles = [...new Set(targets.flatMap(collectSqlTests))].sort()

if (testFiles.length === 0) {
  throw new Error('No .test.sql files were found')
}

let failedTests = 0

for (const [index, testFile] of testFiles.entries()) {
  const relativeName = testFile.slice(backendDirectory.length + 1)
  process.stdout.write(`[${index + 1}/${testFiles.length}] ${relativeName} ... `)

  let queryFile = testFile
  let previewDirectory
  if (previewMigration !== null) {
    const testBody = transactionBody(readFileSync(testFile, 'utf8'), 'rollback')
    previewDirectory = mkdtempSync(join(tmpdir(), 'valtrim-db-preview-'))
    queryFile = join(previewDirectory, 'rollback-test.sql')
    // Generated test input, not a new migration or a rewritten repository file.
    writeFileSync(queryFile, `begin;\nset local lock_timeout = '3s';\nset local statement_timeout = '45s';\n${previewMigration}\n${testBody}\nrollback;\n`, 'utf8')
  }
  let result
  try { result = spawnSync(
    process.execPath,
    [
      supabaseCli,
      'db',
      'query',
      '--linked',
      '--file',
      queryFile,
      '--output-format',
      'json',
    ],
    {
      cwd: backendDirectory,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  ) } finally {
    if (previewDirectory) {
      unlinkSync(queryFile)
      rmdirSync(previewDirectory)
    }
  }

  if (result.status !== 0) {
    failedTests += 1
    console.log('ERROR')
    if (result.stderr) {
      process.stderr.write(result.stderr)
    }
    if (result.stdout) {
      process.stderr.write(result.stdout)
    }
    if (!result.stderr && !result.stdout) {
      process.stderr.write('Supabase CLI failed without output\n')
    }
    continue
  }

  let response

  try {
    response = JSON.parse(result.stdout)
  } catch {
    failedTests += 1
    console.log('ERROR')
    console.error('Supabase CLI returned invalid JSON:')
    process.stderr.write(result.stdout)
    continue
  }

  const resultValues = (response.rows ?? [])
    .flatMap((row) => Object.values(row))
    .filter((value) => typeof value === 'string')
  const failure = resultValues.find((value) => (
    /(^|\n)not ok\b/i.test(value)
    || /looks like you failed\s+\d+\s+tests?/i.test(value)
    || /(?:bad|no) plan/i.test(value)
  ))

  if (failure) {
    failedTests += 1
    console.log('FAIL')
    console.error(failure)
  } else {
    console.log('PASS')
  }
}

console.log(`\n${testFiles.length - failedTests} passed, ${failedTests} failed`)

if (failedTests > 0) {
  process.exitCode = 1
}
