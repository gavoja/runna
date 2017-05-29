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
const VAR_NAME_RE = /^[A-Z]+([0-9]+)?$/
const VAR_RE = /\$[A-Z]+([0-9]+)?/

class Runner {
  init (args) {
    args = args || {}
    this.cfg = this.getJson(path.join(process.cwd(), 'package.json'))
    // this.flavors = typeof args.flavors === 'string' ? args.flavors.split(',') : []
    this.queue = []
    this.vars = args.vars || {}

    this.scripts = this.getScripts()
    // this.getWatch()
    console.log(JSON.stringify(this.scripts, null, 2))
    process.exit()
  }

  applyFlavor (string, flavor) {
    return string.replace(new RegExp('\\' + FLV, 'g'), flavor)
  }

  resolveScriptVar (scripts, varName) {
    let newScripts = {}

    // For each script.
    Object.keys(scripts).forEach(scriptName => {
      newScripts[scriptName] = []
      // For each argument.
      scripts[scriptName].forEach(item => {
        // Add script to new list if no variables found.
        if (!VAR_RE.test(item.script)) {
          return newScripts[scriptName].push(item)
        }

        // Replace variables.
        this.vars[varName].forEach(varValue => {
          let varRe = new RegExp(`\\$${varName}`, 'g')
          newScripts[scriptName].push({script: item.script.replace(varRe, varValue), vars: item.vars + `${varName}=${varValue}&`})
        })
      })
    })

    return newScripts
  }

  getScripts () {
    let scripts = {}
    Object.keys(this.cfg.scripts).forEach(scriptName => {
      let script = this.cfg.scripts[scriptName]
      if (!script.trim()) {
        return console.log(`${RNA} ${ERR} Script is empty: ${scriptName}`)
      }

      scripts[scriptName] = [{script, vars: ''}]
    })

    Object.keys(this.vars).forEach(varName => {
      scripts = this.resolveScriptVar(scripts, varName)
    })

    return scripts
  }

  getWatch () {
    this.watch = {}
    Object.keys(this.cfg.watch).forEach(chain => {
      this.watch[chain] = []
      this.cfg.watch[chain].forEach(pattern => {
        // Non flavored watch.
        if (!pattern.includes(FLV) || !this.flavors.length) {
          return this.watch[chain].push({pattern})
        }

        // Flavored watch.
        this.flavors.forEach(flavor => {
          this.watch[chain].push({pattern: this.applyFlavor(pattern, flavor), flavor})
        })
      })
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

  runScript (scriptName, vars) {
    // Check if script exists.
    let script = this.scripts[scriptName]
    if (!script) {
      console.log(`${RNA} ${ERR} Script does not exist: ${scriptName}`)
      return new Promise((resolve, reject) => resolve())
    }

    let pipeline = []
    script.forEach(item => {
      if (!item.vars || item.vars === vars) {
        let name = s.flavor ? `${scriptName}:${s.flavor}` : scriptName
        pipeline.push(this.runArgs(s.args, name))
      }
    })

    return Promise.all(pipeline)
  }

  runArgs (args, name) {
    return new Promise((resolve, reject) => {
      // Prepare.
      let done
      let timestamp = Date.now()
      let end = callback => {
        if (!done) {
          let duration = Date.now() - timestamp
          console.log(`${RNA} ${LOG} Script ended in ${duration} ms: ${name}`)
          done = resolve()
        }
      }

      // Spawn child process.
      console.log(`${RNA} ${LOG} Script started: ${name}`)
      let child = spawn(args[0], args.slice(1))

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
        this.getLogLines(buf, name).forEach(line => process.stdout.write(line))
      })

      // Capture stderr.
      child.stderr.on('data', buf => {
        this.getLogLines(buf, name).forEach(line => process.stderr.write(line))
      })
    })
  }

  runChain (chain, flavors) {
    flavors = flavors || this.flavors
    return new Promise((resolve, reject) => {
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
        .all(current.map(script => this.runScript(script, flavors)))
        .then(() => this.runChain(remaining, flavors))
        .then(() => resolve())
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
    // Wait for the previous task to complete to avoid concurrency conflicts.
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

    this.processPaths(paths)
  }

  processPaths (paths) {
    // Get the pipeline.
    let pipeline = []
    Object.keys(this.tasks).forEach(taskName => {
      let task = this.tasks[taskName]

      // Get the flavors that match the pattern.
      let flavors = new Set()
      task.watch.some(w => {
        let match = mm(paths, w.pattern)

        // Continue if no match.
        if (match.length === 0) {
          return
        }

        // Add all flavors if generic.
        if (!w.flavor) {
          flavors = new Set(this.flavors)
          return true
        }

        // Add matched flavor.
        flavors.add(w.flavor)
      })

      // Add task to pipeline.
      if (flavors.size > 0) {
        this.lock = true
        pipeline.push(this.runTask(taskName, [...flavors]))
      }
    })

    // Wait for the pipeline to process and unlock.
    if (pipeline.length > 0) {
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
    const chain = process.argv[2].split(' ')
    const args = minimist(process.argv.slice(3))
    const vars = {}
    Object.keys(args).forEach(name => {
      if (VAR_NAME_RE.test(name)) {
        vars[name] = args[name].split(',')
      }
    })

    this.init({vars})
    args.w && this.watch()
    this.runChain(chain).then(() => {
      args.w && this.work()
    })
  }
}

if (require.main === module) {
  let runner = new Runner()
  runner.main()
}

module.exports = Runner
