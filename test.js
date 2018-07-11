'use strict'

const cp = require('child_process')
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const DIST = path.resolve(__dirname, 'test', 'dist')
const TRIGGERS = path.resolve(__dirname, 'test', 'triggers')
const TIMEOUT = 5000
const STEP = 100

// Serously, this should be the default.
process.on('unhandledRejection', reason => console.error(reason))

async function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function wait4 (callback, expectedResult, message) {
  for (let start = Date.now(); Date.now() - start < TIMEOUT; await wait(STEP)) {
    if (callback() === expectedResult) {
      return
    }
  }

  console.error(message)
  process.exit(1)
}

async function exec (command) {
  return new Promise(resolve => {
    cp.exec(command, (err, stdout, stderr) => {
      return err ? resolve(false) : resolve(true)
    })
  })
}

function clean () {
  for (const file of fs.readdirSync(DIST)) {
    fs.unlinkSync(path.resolve(DIST, file))
  }
}

function touch (file) {
  fs.closeSync(fs.openSync(file, 'w'))
}

async function exist (...files) {
  await wait4(() => files.every(f => fs.existsSync(f)), true, `Expected files to exist: ${files}`)
}

async function notExist (...files) {
  await wait4(() => files.every(f => !fs.existsSync(f)), true, `Expected files not to exist: ${files}`)
}

// -----------------------------------------------------------------------------
// Actual test below
// -----------------------------------------------------------------------------

async function test () {
  console.log('Running tests...')

  const items = {
    red: path.resolve(DIST, 'red'),
    blue: path.resolve(DIST, 'blue'),
    plain: path.resolve(DIST, 'plain'),
    mixRed: path.resolve(DIST, 'mix.red'),
    mixBlue: path.resolve(DIST, 'mix.blue')
  }

  const triggers = {
    projRed: path.resolve(TRIGGERS, 'red', 'project'),
    projBlue: path.resolve(TRIGGERS, 'blue', 'project'),
    projSubBlue: path.resolve(TRIGGERS, 'blue', 'sub-folder', 'project'),
    mixRed: path.resolve(TRIGGERS, 'red', 'mix'),
    mixBlue: path.resolve(TRIGGERS, 'blue', 'mix'),
    mixAll: path.resolve(TRIGGERS, 'mix'),
    projAll: path.resolve(TRIGGERS, 'project'),
    plain: path.resolve(TRIGGERS, 'plain')
  }

  let result

  //
  // Build
  //

  clean()
  console.log('Build')
  await exec('npm run build')
  await exist(items.red)
  await exist(items.blue)
  await exist(items.plain)

  clean()
  console.log('Build - no projects')
  await exec('npm run build:noprojects')
  await exist(items.plain)
  await notExist(items.red)
  await notExist(items.blue)

  //
  // Errors
  //

  console.log('Failure - log')
  result = await exec('npm run build:fail:log')
  assert.strictEqual(result, false)

  console.log('Failure - throw')
  result = await exec('npm run build:fail:throw')
  assert.strictEqual(result, false)

  console.log('Failure - non zero exit code')
  result = await exec('npm run build:fail:error')
  assert.strictEqual(result, false)

  //
  // Observe
  //

  clean()
  console.log('Develop')
  exec('npm run dev')
  await wait(3000) // Ensure watching is enabled.

  console.log('Trigger - red/project')
  touch(triggers.projRed)
  await exist(items.red)
  clean()

  console.log('Trigger - blue/project')
  touch(triggers.projBlue)
  await exist(items.blue)
  clean()

  console.log('Trigger - blue/sub-folder/project')
  touch(triggers.projSubBlue)
  await exist(items.blue)
  clean()

  console.log('Trigger - red/mix')
  touch(triggers.mixRed)
  await exist(items.mixRed)
  clean()

  console.log('Trigger - blue/mix')
  touch(triggers.mixBlue)
  await exist(items.mixBlue)
  clean()

  console.log('Trigger - plain')
  touch(triggers.plain)
  await exist(items.plain)
  clean()

  console.log('Trigger - project')
  touch(triggers.projAll)
  await exist(items.blue, items.red)
  clean()

  console.log('Trigger - mix')
  touch(triggers.mixAll)
  await exist(items.mixBlue, items.mixRed)
  clean()

  console.log('All OK.')
  process.exit(0)
}

test()
