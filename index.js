'use strict'

const chalk = require('chalk')
const spawn = require('child_process').spawn
const fs = require('fs')
const minimist = require('minimist')
const mm = require('micromatch')
const path = require('path')
const watch = require('simple-watcher')

const INTERVAL = 300
const WAIT = '-'
const ASNC = '+'
const RNA = chalk.blue('[runna]')
const ERR = chalk.red('[err]')
const LOG = chalk.green('[log]')
const FLV = '$FLV'

class Runner {
  init (args) {
    args = args || {}
    this.cfg = this.getJson(path.join(process.cwd(), 'package.json'))
    this.flavors = args.flavors ? args.flavors.split(',') : []
    this.queue = []

    this.getScripts()
    this.getTasks()
  }

  applyFlavor (string, flavor) {
    return string.replace(new RegExp('\\' + FLV, 'g'), flavor)
  }

  getScripts () {
    this.scripts = {}
    Object.keys(this.cfg.scripts).forEach(scriptName => {
      let script = this.cfg.scripts[scriptName]
      this.scripts[scriptName] = {}

      // Non flavored scripts.
      if (!script.includes(FLV) || !this.flavors.length) {
        this.scripts[scriptName] = {'': this.getSpawnArgs(script)}
        return
      }

      // Flavored scripts
      this.flavors.forEach(flavor => {
        this.scripts[scriptName][flavor] = this.getSpawnArgs(this.applyFlavor(script, flavor))
      })
    })
  }

  getTasks () {
    this.tasks = {}
    Object.keys(this.cfg.runna).forEach(taskName => {
      let task = this.cfg.runna[taskName]
      let watch = {}
      let chain = typeof task === 'string' ? task : task.chain
      chain = chain.replace(/\s+/, ' ').split(' ')

      // Process watch patterns.
      task.watch && task.watch.forEach(pattern => {
        // Non flavored watch.
        if (!pattern.includes(FLV) || !this.flavors.length) {
          watch[''] = pattern
          return
        }

        // Flavored watch.
        this.flavors.forEach(flavor => {
          watch[flavor] = this.applyFlavor(pattern, flavor)
        })
      })

      this.tasks[taskName] = {chain, watch}
    })
  }

  getJson (filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }

  getSpawnArgs (cmd) {
    let args = cmd.split(' ')
    let packageName = args[0]
    let packagePath = path.join(process.cwd(), 'node_modules', packageName)
    if (!fs.existsSync(packagePath)) {
      return args
    }

    let cfg = this.getJson(path.join(packagePath, 'package.json'))
    if (cfg.bin && Object.keys(cfg.bin).includes(packageName)) {
      args[0] = path.join(process.cwd(), 'node_modules', packageName, cfg.bin[packageName])
      // TODO: Get current Node.js location.
      args.unshift('node')
      return args
    }

    return args
  }

  getLogLines (buf, name) {
    return buf.toString('utf8').replace(/[\r|\n]+$/, '').split('\n').map(line => `${chalk.blue('[' + name + ']')} ${line}\n`)
  }

  runScript (scriptName, flavors) {
    // Check if script exists.
    let script = this.scripts[scriptName]
    if (!script) {
      console.log(`${RNA} ${ERR} Script does not exist: ${scriptName}`)
      return new Promise((resolve, reject) => resolve())
    }

    let pipeline = Object.keys(script)
      .filter(flavor => flavors.includes(flavor) || flavor === '')
      .map(flavor => this.runScriptFlavor(scriptName, flavor))
    return Promise.all(pipeline)
  }

  runScriptFlavor (scriptName, flavor = '') {
    return new Promise((resolve, reject) => {
      // Prepare.
      let script = this.scripts[scriptName]
      let done
      let timestamp = Date.now()
      let fullScriptName = flavor ? `${scriptName}:${flavor}` : scriptName
      let end = callback => {
        if (!done) {
          let duration = Date.now() - timestamp
          console.log(`${RNA} ${LOG} Script ended in ${duration} ms: ${fullScriptName}`)
          done = resolve()
        }
      }

      // Spawn child process.
      console.log(`${RNA} ${LOG} Script started: ${fullScriptName}`)
      let child = spawn(script[flavor][0], script[flavor].slice(1))

      // Resolve on proper close.
      child.on('close', code => {
        code === 0 && end()
      })

      // Reject on error.
      child.on('error', err => {
        console.error(err)
        end()
      })

      // Capture stdout.
      child.stdout.on('data', buf => {
        this.getLogLines(buf, fullScriptName).forEach(line => process.stdout.write(line))
      })

      // Capture stderr.
      child.stderr.on('data', buf => {
        this.getLogLines(buf, fullScriptName).forEach(line => process.stderr.write(line))
      })
    })
  }

  runTask (taskName, flavors) {
    flavors = flavors || this.flavors
    return new Promise((resolve, reject) => {
      // Get the chain.
      let task = this.tasks[taskName]
      if (!task) {
        console.error(`${RNA} ${ERR} Task does not exist: ${taskName}`)
        return resolve()
      }

      // Run chain.
      console.log(`${RNA} ${LOG} Running task: ${taskName}`)
      this.runChain(task.chain, flavors, () => resolve())
    })
  }

  runChain (chain, flavors, callback) {
    // Get all scripts up to the wait.
    let current = []
    let remaining = []
    for (let ii = 0; ii < chain.length; ++ii) {
      // Run async scripts.
      if (chain[ii].startsWith(ASNC)) {
        this.runScript(chain[ii].substr(1), flavors)
        continue
      }

      // Stop at wait scripts.
      if (chain[ii].startsWith(WAIT)) {
        chain[ii] = chain[ii].substr(1)
        remaining = chain.slice(ii)
        break
      }

      current.push(chain[ii])
    }

    // Fire callback when nothing to process.
    if (!current.length && !remaining.length) {
      return callback && callback()
    }

    // Execute all current scripts.
    current.length && Promise
      .all(current.map(script => this.runScript(script, flavors)))
      .then(() => {
        // Execute all remaining when current end.
        this.runChain(remaining, flavors, callback)
      })
  }

  watch () {
    watch(process.cwd(), localPath => this.queue.push(localPath))
  }

  work () {
    console.log(`${RNA} ${LOG} Watching for changes ...`)
    if (!this.worker) {
      this.worker = setInterval(this.processQueue.bind(this), INTERVAL)
    }
  }

  processQueue () {
    // Wait for the previous package to install.
    // Otherwise an error may occur if two concurrent packages try to make
    // changes to the same node.
    if (this.lock) {
      return
    }

    // Get unique list of local paths.
    let dict = {}
    while (this.queue.length > 0) {
      dict[this.queue.pop()] = true
    }

    // Get all the items.
    let paths = Object.keys(dict).map(localPath => {
      return localPath.replace(/\\/g, '/').substr(process.cwd().length + 1)
    })

    if (paths.length === 0) {
      return // Skip if no unique paths.
    }

    // Get the pipeline.
    let pipeline = []
    Object.keys(this.tasks).forEach(taskName => {
      let task = this.tasks[taskName]
      Object.keys(task.watch).forEach(flavor => {
        let pattern = task.watch[flavor]
        let match = mm(paths, pattern)
        if (match.length > 0) {
          pipeline.push(this.runTask(taskName, flavor))
        }
      })
    })

    if (pipeline.length > 0) {
      this.lock = true
      Promise.all(pipeline).then(() => {
        this.lock = false
      })
    }
  }

  handleExit () {
    let handler = () => {
      console.log(`${RNA} ${LOG} Shutting down.`)
      process.exit()
    }

    process.on('SIGINT', handler)
  }

  main () {
    let args = minimist(process.argv.slice(3))
    this.init({flavors: args.f})

    args.w && this.watch()
    this.runTask(process.argv[2]).then(() => {
      args.w && this.work()
    })
  }
}

if (require.main === module) {
  let runner = new Runner()
  runner.main()
}

module.exports = Runner
