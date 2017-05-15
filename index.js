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
const RUN = chalk.gray('[run]')
const END = chalk.gray('[end]')
const ERR = chalk.red('[err]')
const LOG = chalk.green('[log]')

class Runner {
  init () {
    let file = path.join(process.cwd(), 'package.json')
    this.cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
    this.queue = []
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

  runScript (name) {
    return new Promise((resolve, reject) => {
      let done
      console.log(`${PREFIX} ${RUN} ${name}`)
      let doReject = () => {
        console.log(`${PREFIX} ${END} ${name}`)
        done = done || reject()
      }

      let doResolve = () => {
        console.log(`${PREFIX} ${END} ${name}`)
        done = done || resolve()
      }

      // Check if script name exists.
      let cmd = this.cfg.scripts[name]

      // FIXME: Find out why this causes unhandled promise rejection
      if (!cmd) {
        console.error(`${PREFIX} ${ERR} Script does not exist: ${name}`)
        return doReject()
      }

      // Fork node processes to enable communication; spawn others.
      let args = cmd.split(' ')
      let child = spawn(args[0], args.slice(1))

      // Resolve on proper close.
      child.on('close', code => {
        code === 0 && doResolve()
      })

      // Reject on error.
      child.on('error', err => {
        console.error(err)
        doReject()
      })

      child.stdout.pipe(process.stdout)
      child.stderr.pipe(process.stderr)
    })
  }

  runTask (name) {
    return new Promise((resolve, reject) => {
      console.log(`${PREFIX} ${LOG} Running task: ${name}`)
      let pipeline = this.getPipeline(name)
      this.runPipeline(pipeline, () => resolve())
    })
  }

  runPipeline (pipeline, callback) {
    // Fire callback when pipeline is all processed.
    if (!pipeline.length) {
      callback && callback()
      return
    }

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
