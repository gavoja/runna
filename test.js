'use strict'

const test = require('triala')
const cp = require('child_process')
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const DIST = path.resolve(__dirname, 'test', 'dist')
const TRIGGERS = path.resolve(__dirname, 'test', 'triggers')
const TIMEOUT = 5000
const STEP = 100

test('runna', class {
  //
  // Helpers
  //

  async _before () {
    if (!fs.existsSync(DIST)) {
      fs.mkdirSync(DIST)
    }
  }

  async _wait (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async _wait4 (callback, expectedResult, message) {
    for (let start = Date.now(); Date.now() - start < TIMEOUT; await this._wait(STEP)) {
      if (callback() === expectedResult) {
        return
      }
    }

    throw new Error(message)
  }

  async _exec (command) {
    return new Promise(resolve => {
      cp.exec(command, (err, stdout, stderr) => {
        return err ? resolve(false) : resolve(true)
      })
    })
  }

  async _spawn (script, delay) {
    return new Promise(resolve => {
      const args = require('./package.json').scripts[script].substr(5).split(' ')
      const child = cp.spawn('node', args)

      child.stdout.on('data', async data => {
        const line = data.toString('utf8')
        // process.stdout.write(line)
        if (line.includes('Watching')) {
          await this._wait(delay) // Not sure why waching does not happen instantly.
          resolve(child)
        }
      })
    })
  }

  async _clean () {
    for (const file of fs.readdirSync(DIST)) {
      fs.unlinkSync(path.resolve(DIST, file))
    }
  }

  async _touch (trigger) {
    const file = path.resolve(TRIGGERS, trigger)
    fs.closeSync(fs.openSync(file, 'w'))
  }

  async _exist (...items) {
    await this._wait4(() => items.every(item => fs.existsSync(path.resolve(DIST, item))), true, `Expected items to exist: ${items}`)
  }

  async _notExist (...items) {
    await this._wait4(() => items.every(item => !fs.existsSync(path.resolve(DIST, item))), true, `Expected items not to exist: ${items}`)
  }

  async _trigger (task, trigger, result, delay = 10) {
    result = Array.isArray(result) ? result : [result]
    const child = await this._spawn(task, delay)
    this._touch(trigger)
    await this._exist(...result)
    child.kill()
  }

  //
  // Tests: run command
  //

  async 'rimraf' () {
    const junk = path.resolve(DIST, 'junk')
    fs.writeFileSync(junk)
    assert(fs.existsSync(junk), 'junk does not exist')
    await this._exec('npm run bin')
    assert(!fs.existsSync(junk), 'junk exists')
  }

  //
  // Tests: build
  //

  async 'build' () {
    this._clean()
    await this._exec('npm run build')
    await this._exist('red')
    await this._exist('blue')
    await this._exist('plain')
  }

  async 'build - no projects' () {
    this._clean()
    await this._exec('npm run build:noprojects')
    await this._exist('plain')
    await this._notExist('red')
    await this._notExist('blue')
  }

  //
  // Tests: errors
  //

  async 'failure - log' () {
    assert.strictEqual(await this._exec('npm run build:fail:log'), false)
  }

  async 'failure - throw' () {
    assert.strictEqual(await this._exec('npm run build:fail:throw'), false)
  }

  async 'failure - non zero exit code' () {
    assert.strictEqual(await this._exec('npm run build:fail:error'), false)
  }

  //
  // Tests: observe
  //

  async 'trigger - blue/skip' () {
    const child = await this._spawn('dev')
    this._touch('blue/skip')
    await this._wait(3000)
    await this._notExist('blue')
    child.kill()
  }

  async 'trigger - blue/sub-folder/skip' () {
    const child = await this._spawn('dev')
    this._touch('blue/sub-folder/skip')
    await this._wait(3000)
    await this._notExist('blue')
    child.kill()
  }

  async 'trigger - blue/bulk/exclude' () {
    const child = await this._spawn('dev')
    this._touch('blue/bulk/exclude')
    await this._wait(3000)
    await this._notExist('blue')
    child.kill()
  }

  async 'trigger - blue/bulk/include' () {
    await this._trigger('dev', 'blue/bulk/include', 'blue')
  }

  async 'trigger - red/project' () {
    await this._trigger('dev', 'red/project', 'red')
  }

  async 'trigger - blue/project' () {
    await this._trigger('dev', 'blue/project', 'blue')
  }

  async 'trigger - blue/sub-folder/project' () {
    await this._trigger('dev', 'blue/sub-folder/project', 'blue')
  }

  async 'trigger - red/mix' () {
    await this._trigger('dev', 'red/mix', 'mix.red')
  }

  async 'trigger - blue/mix' () {
    await this._trigger('dev', 'blue/mix', 'mix.blue')
  }

  async 'trigger - plain' () {
    await this._trigger('dev', 'plain', 'plain')
  }

  async 'trigger - project' () {
    await this._trigger('dev', 'project', ['blue', 'red'])
  }

  async 'trigger - mix' () {
    await this._trigger('dev', 'mix', ['mix.blue', 'mix.red'])
  }

  //
  // Tests: observe with polling
  //

  async 'polling trigger - blue/skip' () {
    const child = await this._spawn('dev:polling', 2000)
    this._touch('blue/skip')
    await this._wait(3000)
    await this._notExist('blue')
    child.kill()
  }

  async 'polling trigger - blue/sub-folder/skip' () {
    const child = await this._spawn('dev:polling', 2000)
    this._touch('blue/sub-folder/skip')
    await this._wait(3000)
    await this._notExist('blue')
    child.kill()
  }

  async 'polling trigger - blue/bulk/exclude' () {
    const child = await this._spawn('dev:polling', 2000)
    this._touch('blue/bulk/exclude')
    await this._wait(3000)
    await this._notExist('blue')
    child.kill()
  }

  async 'polling trigger - blue/bulk/include' () {
    await this._trigger('dev:polling', 'blue/bulk/include', 'blue', 2000)
  }

  async 'polling trigger - red/project' () {
    await this._trigger('dev:polling', 'red/project', 'red', 2000)
  }

  async 'polling trigger - blue/project' () {
    await this._trigger('dev:polling', 'blue/project', 'blue', 2000)
  }

  async 'polling trigger - blue/sub-folder/project' () {
    await this._trigger('dev:polling', 'blue/sub-folder/project', 'blue', 2000)
  }

  async 'polling trigger - red/mix' () {
    await this._trigger('dev:polling', 'red/mix', 'mix.red', 2000)
  }

  async 'polling trigger - blue/mix' () {
    await this._trigger('dev:polling', 'blue/mix', 'mix.blue', 2000)
  }

  async 'polling trigger - plain' () {
    await this._trigger('dev:polling', 'plain', 'plain', 2000)
  }

  async 'polling trigger - project' () {
    await this._trigger('dev:polling', 'project', ['blue', 'red'], 2000)
  }

  async 'polling trigger - mix' () {
    await this._trigger('dev:polling', 'mix', ['mix.blue', 'mix.red'], 2000)
  }
})
