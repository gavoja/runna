'use strict'

const spawn = require('child_process').spawn
const log = require('./log').getInstance()
const path = require('path')

class Script {
  constructor (name, code) {
    this.name = name
    this.code = code
    this.done = false
    this.pid = null
    this.child = null
    this.exitCode = 0
    this.onEnd = null
    this.duration = 0
  }

  setName (name) {
    this.name = name
  }

  isBackground () {
    return this.name.includes('+')
  }

  isPause () {
    return this.name === '-'
  }

  end () {
    this.done = true
    this.onEnd && this.onEnd()
  }

  hasEnded () {
    return this.done === true
  }

  hasFailed () {
    return !this.isValid() || this.exitCode !== 0
  }

  isRunning () {
    return this.pid !== null && !this.hasEnded()
  }

  isValid () {
    return this.code || this.isPause()
  }

  async start (onEnd) {
    this.onEnd = onEnd

    // Handle invalid scripts.
    if (!this.isValid()) {
      log.err('runna', `Script ${this.name} is not valid.`)
      return
    }

    if (this.isPause()) {
      this.pid = 0
      return
    }

    if (this.isRunning()) {
      return
    }

    const spawnArgs = this.code.split(' ')

    // Spawn a child process.
    // Scripts running in the background should not exit on error.
    return new Promise(resolve => {
      const timestamp = Date.now()

      // Spawn child process. Use shell to make sure the proper path is used.
      // This ensures script resolution from either npm or yarn across all
      // operating systems.
      log.dbg('runna', `Script ${this.name} started.`)
      const child = spawn(spawnArgs[0], spawnArgs.slice(1), { shell: true })

      // Finalization handling.
      let done
      const end = () => {
        if (!done) {
          this.duration = Date.now() - timestamp
          log.dbg('runna', `Script ${this.name} completed in ${this.duration} ms.`)
          this.end()
          done = resolve()
        }
      }

      child.on('close', code => {
        if (code !== 0) {
          log.err('runna', `Script ${this.name} exited with error code ${code}.`)
          this.fail(code)
        }

        end()
      })

      child.on('error', err => {
        log.err('runna', `Script ${this.name} threw an error.`)
        log.err(this.name, err)
        this.fail(1)

        end()
      })

      // Capture stderr.
      child.stderr.on('data', buf => {
        log.err(this.name, buf)
        if (!this.isBackground()) {
          this.fail(1)
        }
      })

      // Capture stdout.
      child.stdout.on('data', buf => {
        log.dbg(this.name, buf)
      })

      // Update script
      this.pid = child.pid
      this.child = child
    })
  }

  _getSpawnArgs (cmd, binaries) {
    const args = cmd.split(' ')
    const packageName = args[0]

    // Resolve local package binary.
    if (binaries[packageName]) {
      args[0] = binaries[packageName]
    }

    return [args, false]
  }

  fail (code) {
    this.exitCode = code
  }

  //
  // Initialization.
  //

  static getInstances (name, code, files = [], projects = []) {
    if (!name) {
      throw new Error('Script must have a name.')
    }

    const script = new Script(name, code)
    if (!script.isPause() && !code) {
      throw new Error(`Unknown script: ${name}`)
    }

    // Plain script.
    const scripts = []
    if (script.isPause() || script._isPlain()) {
      scripts.push(script)
    } else if (script._isProjOnly()) {
      for (const project of projects) {
        scripts.push(new Script(`${script.name}::${project}`, script.code.replace(/\$PROJ/g, project)))
      }
    } else if (script._isFileOnly()) {
      for (const file of files) {
        const suffix = file ? `::${path.basename(file)}` : ''
        scripts.push(new Script(`${script.name}${suffix}`, script.code.replace(/\$FILE/g, file)))
      }
    } else if (script._isProjAndFile()) {
      for (const project of projects) {
        const projCode = script.code.replace(/\$PROJ/g, project)
        for (const file of files) {
          const suffix = file ? `:${path.basename(file)}` : ''
          scripts.push(new Script(`${script.name}::${project}${suffix}`, projCode.replace(/\$FILE/g, file)))
        }
      }
    }

    return scripts
  }

  _isPlain (code) {
    return !this.code.includes('$PROJ') && !this.code.includes('$FILE')
  }

  _isProjOnly () {
    return this.code.includes('$PROJ') && !this.code.includes('$FILE')
  }

  _isFileOnly () {
    return !this.code.includes('$PROJ') && this.code.includes('$FILE')
  }

  _isProjAndFile () {
    return this.code.includes('$PROJ') && this.code.includes('$FILE')
  }
}

module.exports = Script
