'use strict'

const chalk = require('chalk')
const spawn = require('child_process').spawn
const fs = require('fs')
const minimist = require('minimist')
const mm = require('micromatch')
const path = require('path')
const watch = require('simple-watcher')

const CHILD_EXIT_WAIT = 50
const FILE_WATCH_WAIT = 300
const RNA = chalk.blue('runna')
const ERR = chalk.red('err')
const LOG = chalk.green('log')
const HELP = `
Usage:
  runna <chain> [OPTIONS]

Options:
  -f <flavors>             Enable flavors; a comma separated list.
  -w [<path_to_watch>]     Default is current.
`

class Runner {
  async main () {
    const version = this.getJson(path.join(__dirname, 'package.json')).version
    console.log(`Runna version ${version}.`)

    if (process.argv.length < 3) {
      console.log(HELP)
      process.exit(0)
    }

    const chain = process.argv[2]
    const args = minimist(process.argv.slice(3))
    const pathToWatch = (args.w === true && process.cwd()) || (typeof args.w === 'string' && path.resolve(args.w))
    const flavors = args.f ? args.f.trim().split(',') : []

    this.init(chain, flavors, pathToWatch)
  }

  async init (chain, flavors, pathToWatch) {
    this.handleExit()

    this.cfg = this.getCfg()
    this.queue = []
    this.children = {}

    await this.runChain(chain, flavors)
    pathToWatch && this.observe(pathToWatch, flavors)
  }

  //
  // Chain processing.
  //

  // chain ~ '+foo - bar baz'
  async runChain (chain, flavors, exitOnError = true) {
    const timestamp = Date.now()

    // Get scripts: [{
    //   name: 'some:script'
    //   isBackground: false,
    //   isPause: false,
    //   code: 'node some-script.js -f flavor1'
    // }]
    const scripts = []
    for (const text of chain.split(' ')) {
      const name = text.replace(/[+]*(.*)/g, '$1')
      const isBackground = text.includes('+')
      const isPause = text === '-'
      const code = this.cfg.scripts[name]

      // Add non-flavoured script.
      if (!code || !code.includes('$FLV')) {
        scripts.push({name, isBackground, isPause, code})
        continue
      }

      // Add flavoured scripts.
      for (const flavor of flavors) {
        scripts.push({name: `${name}::${flavor}`, isBackground, isPause, code: code.replace(/\$FLV/g, flavor)})
      }
    }

    // Run all the scripts in a chain.
    let msg = flavors.length ? `${chalk.magenta(chain)} :: ${chalk.magenta(flavors)}` : chalk.magenta(chain)

    console.log(`${RNA} ${LOG} Chain ${msg} started.`)
    for (const script of scripts) {
      if (script.isPause) {
        await this.waitForAllChildrenToComplete()
      } else {
        this.runScript(script, exitOnError)
      }
    }
    await this.waitForAllChildrenToComplete()
    const duration = Date.now() - timestamp
    console.log(`${RNA} ${LOG} Chain ${msg} completed in ${duration} ms.`)
  }

  async waitForAllChildrenToComplete () {
    console.log(`${RNA} ${LOG} Waiting for all running scripts to complete...`)
    while (Object.keys(this.children).length !== 0) {
      await this.wait(CHILD_EXIT_WAIT)
    }
  }

  // Spawn child process.
  async runScript (script, exitOnError) {
    const spawnArgs = this.getSpawnArgs(script.code)
    return new Promise(resolve => {
      const timestamp = Date.now()

      // Spawn child process.
      console.log(`${RNA} ${LOG} Script ${script.name} started.`)
      const child = spawn(spawnArgs[0], spawnArgs.slice(1))

      // Finalization handling.
      let done
      const end = () => {
        if (!done) {
          let duration = Date.now() - timestamp
          console.log(`${RNA} ${LOG} Script ${script.name} completed in ${duration} ms.`)
          delete this.children[child.pid]
          done = resolve()
        }
      }

      child.on('close', code => {
        if (code !== 0) {
          console.error(`${RNA} ${ERR} Script ${script.name} exited with error code ${code}.`)
          this.handleError(exitOnError)
        }
        end()
      })

      child.on('error', err => {
        console.error(`${RNA} ${ERR} Script ${script.name} threw an error.`)
        console.error(err)
        this.handleError(exitOnError)
        end()
        // throw err
      })

      // Capture stdout.
      child.stdout.on('data', buf => {
        this.getLogLines(buf, script.name, LOG).forEach(line => process.stdout.write(line))
      })

      // Capture stderr.
      child.stderr.on('data', buf => {
        this.getLogLines(buf, script.name, ERR).forEach(line => process.stderr.write(line))
        this.handleError(exitOnError)
      })

      // Memorize.
      if (!script.isBackground) {
        this.children[child.pid] = child
      }
    })
  }

  getSpawnArgs (cmd) {
    const args = cmd.split(' ')
    const packageName = args[0]

    // Resolve local package binary.
    if (this.cfg.binaries[packageName]) {
      args[0] = this.cfg.binaries[packageName]
      args.unshift(process.execPath)
    }

    return args
  }

  //
  // Watching.
  //

  async observe (pathToWatch, flavors) {
    // Get rules: [{
    //   chain: '+foo - bar baz'
    //   pattern: 'c:/absolute/path/to/flavor1/**'
    //   flavors: ['flavor1']
    // },{
    //   chain: '+foo - bar baz'
    //   pattern: 'c:/absolute/path/to/flavor2/**'
    //   flavors: [flavor2']
    // },{
    //   chain: '+foo - bar baz'
    //   pattern: 'c:/absolute/path/to/base/**'
    //   flavors: ['flavor1', 'flavor2']
    // }]
    const rules = []
    for (const [chain, patterns] of Object.entries(this.cfg.observe)) {
      for (let pattern of patterns) {
        // Align with directory structure and normalize slashes.
        pattern = path.resolve(pathToWatch, pattern).replace(/\\/g, '/')

        // Non-flavoured pattern means all the flavors apply.
        if (!pattern.includes('$FLV')) {
          rules.push({chain, pattern, flavors})
          continue
        }
        // Add rule for each flavor separately.
        for (const flavor of flavors) {
          rules.push({chain, pattern: pattern.replace(/\$FLV/g, flavor), flavors: [flavor]})
        }
      }
    }

    // Initialize queue.
    this.queue = []
    const waitMsg = `${RNA} ${LOG} Watching ${chalk.yellow(pathToWatch)} for changes...`
    console.log(waitMsg)
    watch(pathToWatch, localPath => this.queue.push(localPath))

    // Main loop.
    while (true) {
      if (await this.processQueue(rules)) {
        console.log(waitMsg)
      }
      await this.wait(FILE_WATCH_WAIT)
    }
  }

  async processQueue (rules) {
    if (this.lock || this.queue.length === 0) {
      return
    }

    this.lock = true

    // Dequeue items and normalize slashes.
    const paths = Array.from(new Set(this.queue.splice(0))).map(p => p.replace(/\\/g, '/'))

    // Iterate over changes and look for a match.
    const chainsToRun = {}
    for (const rule of rules) {
      const match = mm.match(paths, rule.pattern)
      if (match.length === 0) {
        continue
      }

      for (const m of match) {
        console.log(`${RNA} ${LOG} Changed ${chalk.yellow(path.resolve(m))}`)
      }

      if (!chainsToRun[rule.chain]) {
        chainsToRun[rule.chain] = new Set(rule.flavors)
        continue
      }

      for (const flavor of rule.flavors) {
        chainsToRun[rule.chain].add(flavor)
      }
    }

    const any = Object.keys(chainsToRun).length > 0
    for (const [chain, flavors] of Object.entries(chainsToRun)) {
      await this.runChain(chain, Array.from(flavors), false)
    }

    this.lock = false
    return any
  }

  //
  // Exit handling.
  //

  killChildren () {
    for (const child of Object.values(this.children)) {
      child.pid && child.kill('SIGINT')
    }
  }

  handleError (exitOnError) {
    process.exitCode = 1
    if (exitOnError) {
      console.log(`${RNA} ${LOG} Shutting down.\n`)
      this.killChildren()
      process.exit(1)
    }
  }

  handleExit () {
    process.on('SIGINT', () => {
      console.log(`${RNA} ${LOG} Shutting down.\n`)
      this.killChildren()
      process.exit()
    })
  }

  //
  // Helpers.
  //

  getJson (filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }

  resolveLocalBinaries (cfg) {
    cfg.binaries = {}
    const deps = [].concat(Object.keys(cfg.dependencies || []), Object.keys(cfg.devDependencies || []))
    for (const packageName of deps) {
      const packagePath = path.join(process.cwd(), 'node_modules', packageName)
      if (!fs.existsSync(packagePath)) {
        continue
      }

      const packageCfg = this.getJson(path.join(packagePath, 'package.json'))
      if (!packageCfg.bin) {
        continue
      }

      if (typeof packageCfg.bin === 'string') {
        cfg.binaries[packageName] = path.join(packagePath, packageCfg.bin)
        continue
      }

      for (const [binName, binPath] of Object.entries(packageCfg.bin)) {
        cfg.binaries[binName] = path.join(packagePath, binPath)
      }
    }

    return cfg
  }

  getCfg () {
    const cfg = this.getJson(path.join(process.cwd(), 'package.json'))
    cfg.flavors = cfg.flavors || {}
    return this.resolveLocalBinaries(cfg)
  }

  getLogLines (buf, name, log) {
    const trimmed = buf.toString('utf8').trim()
    return trimmed ? trimmed.split('\n').map(line => `${chalk.blue(name)} ${log} ${line}\n`) : []
  }

  async wait (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

if (require.main === module) {
  const runner = new Runner()
  runner.main()
}

module.exports = Runner
