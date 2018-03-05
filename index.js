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
    this.cfg = this.getCfg()
    this.flavors = this.getFlavors(this.cfg, args.flavors)
    this.scripts = this.getScripts(this.cfg, this.flavors)
    this.observe = this.getObserve(this.cfg, this.flavors)
    this.queue = []

    // console.log(JSON.stringify(this.observe, null, 2))
  }

  main () {
    this.handleExit()

    const chain = process.argv[2].split(' ')
    const args = minimist(process.argv.slice(3))
    const pathToWatch = (args.w === true && process.cwd()) || (typeof args.w === 'string' && path.resolve(args.w))

    this.init({flavors: args.f === true ? '' : args.f})
    this.watch(pathToWatch)
    this.runChain(chain, this.scripts, this.flavors, !pathToWatch).then(() => {
      this.work(pathToWatch)
    })
  }

  watch (pathToWatch) {
    if (!pathToWatch) {
      return
    }

    pathToWatch && watch(pathToWatch, localPath => this.queue.push(localPath))
  }

  work (pathToWatch) {
    if (pathToWatch) {
      console.log(`${RNA} ${LOG} Watching for changes (${pathToWatch}) ...`)
      if (!this.worker) {
        this.worker = setInterval(this.processQueue.bind(this, pathToWatch), INTERVAL)
      }
    }
  }

  processQueue (pathToWatch) {
    // Wait for the previous task to complete to avoid concurrency conflicts.
    if (this.lock) {
      return
    }

    // Get unique list of local paths.
    const dict = {}
    while (this.queue.length > 0) {
      dict[this.queue.pop()] = true
    }

    // Get all the items.
    const paths = Object.keys(dict).map(localPath => {
      return localPath.replace(/\\/g, '/').substr(pathToWatch.length + 1)
    })

    if (paths.length === 0) {
      return // Skip if no unique paths.
    }

    this.processPaths(paths)
  }

  processPaths (paths) {
    // Get the pipeline.
    const pipeline = []
    Object.keys(this.observe).forEach(chain => {
      // Get the flavors that match the pattern.
      let flavors = new Set()
      const doRunChain = this.observe[chain].some(w => {
        const match = mm(paths, w.pattern)

        // Continue if no match.
        if (match.length === 0) {
          return false
        }

        if (w.flavor) {
          // Add matched flavor.
          this.addFlavor(this.cfg, flavors, w.flavor)
          // flavors.add(w.flavor)
        } else {
          // Add all flavors if generic.
          flavors = new Set(this.flavors)
        }

        return true
      })

      // Add task to pipeline.
      if (doRunChain) {
        this.lock = true
        pipeline.push(this.runChain(chain.split(' '), this.scripts, [...flavors], false))
      }
    })

    // Wait for the pipeline to process and unlock.
    if (pipeline.length > 0) {
      Promise.all(pipeline).then(() => {
        this.lock = false
      })
    }
  }

  //
  // No side effects.
  //

  getCfg () {
    const cfg = this.getJson(path.join(process.cwd(), 'package.json'))
    cfg.flavors = cfg.flavors || {}
    return cfg
  }

  addFlavor (cfg, flavors, flavor) {
    flavors.add(flavor)
    cfg.flavors[flavor] && cfg.flavors[flavor].forEach(f => flavors.add(f))
  }

  getFlavors (cfg, farg) {
    let flavors = []
    if (typeof farg === 'string') {
      flavors = farg ? farg.split(',') : Object.keys(cfg.flavors)
    }

    console.log(`${RNA} ${LOG} With flavors: ${flavors.join(', ')}`)
    return flavors
  }

  applyFlavor (string, flavor) {
    return string.replace(new RegExp('\\' + FLV, 'g'), flavor)
  }

  getScripts (cfg, flavors) {
    const scripts = {}
    Object.keys(cfg.scripts).forEach(scriptName => {
      const script = cfg.scripts[scriptName]
      if (!script.trim()) {
        return console.log(`${RNA} ${ERR} Script is empty: ${scriptName}`)
      }

      scripts[scriptName] = []

      // Non flavored scripts.
      if (!script.includes(FLV) || !flavors.length) {
        return scripts[scriptName].push({args: this.getSpawnArgs(script)})
      }

      // Flavored scripts
      flavors.forEach(flavor => {
        const args = this.getSpawnArgs(this.applyFlavor(script, flavor))
        scripts[scriptName].push({args, flavor})
      })
    })

    return scripts
  }

  getObserve (cfg, flavors) {
    const observe = {}
    Object.keys(cfg.observe).forEach(chain => {
      observe[chain] = []
      cfg.observe[chain].forEach(pattern => {
        // Non flavored observe.
        if (!pattern.includes(FLV) || !flavors.length) {
          return observe[chain].push({pattern})
        }

        // Flavored observe.
        flavors.forEach(flavor => {
          observe[chain].push({pattern: this.applyFlavor(pattern, flavor), flavor})
        })
      })
    })

    return observe
  }

  getJson (filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }

  getSpawnArgs (cmd) {
    const args = cmd.split(' ')
    const packageName = args[0]
    const packagePath = path.join(process.cwd(), 'node_modules', packageName)
    if (!fs.existsSync(packagePath)) {
      return args
    }

    const cfg = this.getJson(path.join(packagePath, 'package.json'))
    if (cfg.bin && Object.keys(cfg.bin).includes(packageName)) {
      args[0] = path.join(process.cwd(), 'node_modules', packageName, cfg.bin[packageName])
      // TODO: Get current Node.js location.
      args.unshift('node')
      return args
    }

    return args
  }

  getLogLines (buf, name, log) {
    const trimmed = buf.toString('utf8').trim()
    return trimmed ? trimmed.split('\n').map(line => `${chalk.blue('[' + name + ']')} ${log} ${line}\n`) : []
  }

  runScript (scriptName, scripts, flavors) {
    // Check if script exists.
    const script = scripts[scriptName]
    if (!script) {
      console.log(`${RNA} ${ERR} Script does not exist: ${scriptName}`)
      return new Promise(resolve => resolve())
    }

    const pipeline = []
    script.forEach(s => {
      if (!s.flavor || flavors.includes(s.flavor)) {
        let name = s.flavor ? `${scriptName}:${s.flavor}` : scriptName
        pipeline.push(this.runArgs(s.args, name))
      }
    })

    return Promise.all(pipeline)
  }

  runArgs (args, name) {
    // In case of any errors with a child process, the main process should exit with an error.
    return new Promise(resolve => {
      let done
      const timestamp = Date.now()
      const end = () => {
        if (!done) {
          let duration = Date.now() - timestamp
          console.log(`${RNA} ${LOG} Script ended in ${duration} ms: ${name}`)
          done = resolve()
        }
      }

      // Spawn child process.
      console.log(`${RNA} ${LOG} Script started: ${name}`)
      const child = spawn(args[0], args.slice(1))

      child.on('close', () => {
        end()
      })

      child.on('error', err => {
        console.error(err)
        this.handleError(watch)
        end()
      })

      // Capture stdout.
      child.stdout.on('data', buf => {
        this.getLogLines(buf, name, LOG).forEach(line => process.stdout.write(line))
      })

      // Capture stderr.
      child.stderr.on('data', buf => {
        this.handleError(watch)
        this.getLogLines(buf, name, ERR).forEach(line => process.stderr.write(line))
      })
    })
  }

  handleError (watch) {
    if (!watch) {
      process.exit(1)
    }

    process.exitCode = 1
  }

  runChain (chain, scripts, flavors, exitOnError) {
    return new Promise(resolve => {
      // Get all scripts up to the wait.
      const current = []
      let remaining = []
      for (let ii = 0; ii < chain.length; ++ii) {
        // Run async scripts.
        if (chain[ii].startsWith(ASNC)) {
          this.runScript(chain[ii].substr(1), scripts, flavors)
          continue
        }

        // Stop at wait scripts.
        if (chain[ii].startsWith(WAIT)) {
          remaining = chain.slice(ii)
          remaining[0] = remaining[0].substr(1)
          break
        }

        current.push(chain[ii])
      }

      // Fire callback when nothing to process.
      if (!current.length && !remaining.length) {
        return resolve()
      }

      // Execute all current scripts.
      current.length && Promise
        .all(current.map(script => this.runScript(script, scripts, flavors)))
        .then(() => this.runChain(remaining, scripts, flavors, exitOnError))
        .then(() => resolve())
    })
  }

  handleExit () {
    const handler = () => {
      console.log(`${RNA} ${LOG} Shutting down.`)
      process.exit()
    }

    process.on('SIGINT', handler)
  }
}

if (require.main === module) {
  const runner = new Runner()
  runner.main()
}

module.exports = Runner
