'use strict'

const cp = require('child_process')
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const DIST = path.resolve(__dirname, 'test', 'dist')
const SRC = path.resolve(__dirname, 'test', 'src')
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
    cp.exec(command, (err, stdout, stderr) => err ? resolve(false) : resolve(true))
  })
}

function clean () {
  for (const file of fs.readdirSync(DIST)) {
    fs.unlinkSync(path.resolve(DIST, file))
  }
}

// -----------------------------------------------------------------------------
// Actual test below
// -----------------------------------------------------------------------------

async function test () {
  console.log('Running tests...')

  const red = path.resolve(DIST, 'item.red')
  const blue = path.resolve(DIST, 'item.blue')
  const plain = path.resolve(DIST, 'item.plain')
  const triggerRed = path.resolve(SRC, 'red', 'trigger')
  const triggerBlue = path.resolve(SRC, 'blue', 'trigger')
  const triggerPlain = path.resolve(SRC, 'trigger.plain')
  const trigger = path.resolve(SRC, 'trigger')
  let result

  //
  // Build
  //

  clean()
  console.log('Build')
  await exec('npm run build')
  assert.strictEqual(fs.existsSync(red), true, 'Expected item.red to exist.')
  assert.strictEqual(fs.existsSync(blue), true, 'Expected item.blue to exist.')
  assert.strictEqual(fs.existsSync(plain), true, 'Expected item.plain to exist.')

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

  // Clean up
  clean()
  console.log('Develop')
  exec('npm run dev')
  await wait4(() => fs.existsSync(red) && fs.existsSync(blue) && fs.existsSync(plain), true, 'Expected all items to be generated.')
  clean()

  // Trigger red.
  console.log('Trigger - red')
  fs.closeSync(fs.openSync(triggerRed, 'w'))
  await wait4(() => fs.existsSync(red) && !fs.existsSync(blue) && !fs.existsSync(plain), true, 'Expected item.red to be generated.')
  clean()

  // Trigger blue.
  console.log('Trigger - blue')
  fs.closeSync(fs.openSync(triggerBlue, 'w'))
  await wait4(() => !fs.existsSync(red) && fs.existsSync(blue) && !fs.existsSync(plain), true, 'Expected item.blue to be generated.')
  clean()

  // Trigger plain.
  console.log('Trigger - plain')
  fs.closeSync(fs.openSync(triggerPlain, 'w'))
  await wait4(() => !fs.existsSync(red) && !fs.existsSync(blue) && fs.existsSync(plain), true, 'Expected item.plain to be generated.')
  clean()

  // Trigger flavred.
  console.log('Trigger - all flavors')
  fs.closeSync(fs.openSync(trigger, 'w'))
  await wait4(() => fs.existsSync(red) && fs.existsSync(blue) && !fs.existsSync(plain), true, 'Expected flavored items to be generated.')
  clean()

  console.log('All OK.')
  process.exit(0)
}

test()
