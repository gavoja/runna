'use strict'

const chalk = require('chalk')
const spawn = require('child_process').spawn
const fs = require('fs')
const minimist = require('minimist')
const mm = require('micromatch')
const path = require('path')
const watch = require('simple-watcher')

const WAIT = '-'
const ASNC = '+'
const INTERVAL = 300
const PREFIX = chalk.blue('[runna]')
const ERR = chalk.red('[err]')
const LOG = chalk.green('[log]')

class Runner {
  init () {
    this.cfg = this.getJson(path.join(process.cwd(), 'package.json'))
    this.queue = []

    this.handleExit()
  }

  getJson (filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }

  getArgs (cmd) {
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

  runScript (name) {
    return new Promise((resolve, reject) => {
      let done
      let timestamp = Date.now()
      console.log(`${PREFIX} ${LOG} Script started: ${name}`)

      let end = callback => {
        if (!done) {
          let duration = Date.now() - timestamp
          console.log(`${PREFIX} ${LOG} Script ended in ${duration} ms: ${name}`)
          done = callback()
        }
      }

      // Check if script name exists.
      let cmd = this.cfg.scripts[name]
      if (!cmd) {
        // FIXME: Find out why this causes unhandled promise rejection
        console.error(`${PREFIX} ${ERR} Script does not exist: ${name}`)
        return end(reject)
      }

      // Get command arguments.
      let args = this.getArgs(cmd)

      // Spawn child process.
      let child = spawn(args[0], args.slice(1))

      // Resolve on proper close.
      child.on('close', code => {
        code === 0 && end(resolve)
      })

      // Reject on error.
      child.on('error', err => {
        console.error(err)
        end(reject)
      })

      // Capture stdout.
      child.stdout.on('data', buf => {
        this.getLogLines(buf, name).forEach(line => process.stdout.write(line))
      })

      // Capture stderr.
      child.stderr.on('data', buf => {
        this.getLogLines(buf, name).forEach(line => process.stderr.write(line))
      })
    })
  }

  getLogLines (buf, name) {
    return buf.toString('utf8').replace(/\n$/, '').split('\n').map(line => `${chalk.blue('[' + name + ']')} ${line}\n`)
  }

  runTask (name) {
    return new Promise((resolve, reject) => {
      console.log(`${PREFIX} ${LOG} Running task: ${name}`)
      let pipeline = this.getPipeline(name)
      this.runPipeline(pipeline, () => resolve())
    })
  }

  getPipeline (name) {
    let task = this.cfg.runna[name]
    if (!task) {
      console.error(`${PREFIX} ${ERR} Task does not exist: ${name}`)
      return []
    }

    task = typeof task === 'string' ? task : task.chain
    return task.replace(/\s+/g, ' ').split(' ')
  }

  runPipeline (pipeline, callback) {
    // Get all scripts up to the wait.
    let current = []
    let remaining = []
    for (let ii = 0; ii < pipeline.length; ++ii) {
      // Run async scripts.
      if (pipeline[ii].startsWith(ASNC)) {
        this.runScript(pipeline[ii].substr(1))
        continue
      }

      // Stop at wait scripts.
      if (pipeline[ii].startsWith(WAIT)) {
        pipeline[ii] = pipeline[ii].substr(1)
        remaining = pipeline.slice(ii)
        break
      }

      current.push(pipeline[ii])
    }

    // Fire callback when nothing to process.
    if (!current.length && !remaining.length) {
      return callback && callback()
    }

    // Execute all current scripts.
    current.length && Promise
      .all(current.map(script => this.runScript(script)))
      .then(() => {
        // Execute all remaining when current end.
        this.runPipeline(remaining, callback)
      })
  }

  watch () {
    watch(process.cwd(), localPath => this.queue.push(localPath))
  }

  work () {
    console.log(`${PREFIX} ${LOG} Watching for changes ...`)
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
    Object.keys(this.cfg.runna).forEach(taskName => {
      let task = this.cfg.runna[taskName]
      if (!task.watch) {
        return
      }

      let match = mm(paths, task.watch)
      if (match.length > 0) {
        pipeline.push(this.runTask(taskName))
      }
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
      console.log(`${PREFIX} ${LOG} Shutting down.`)
      process.exit()
    }

    process.on('SIGINT', handler)
  }
}

if (require.main === module) {
  let args = minimist(process.argv.slice(3))

  // Initialise runner.
  let runner = new Runner()
  runner.init()

  args.w && runner.watch()
  runner.runTask(process.argv[2]).then(() => {
    args.w && runner.work()
  })
}

module.exports = Runner
