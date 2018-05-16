'use strict'

const chalk = require('chalk')
const spawn = require('child_process').spawn
const fs = require('fs')
const path = require('path')
const watch = require('simple-watcher')
const subarg = require('subarg')
const globToRegExp = require('glob-to-regexp')

const CHILD_EXIT_WAIT = 50
const FILE_WATCH_WAIT = 300
const RNA = chalk.blue('runna')
const ERR = chalk.red('err')
const LOG = chalk.green('log')
const HELP = `
Usage:
  runna <chain> [options]

Options:
  -p <projects>            Run with projects; a comma separated list.
  -w [<path-to-watch>]     Default is current.
`

// Serously, this should be the default.
process.on('unhandledRejection', reason => console.error(reason))

class Runner {
  async main () {
    const version = this.getJson(path.join(__dirname, 'package.json')).version
    console.log(`Runna version ${version}.`)

    const args = subarg(process.argv.slice(2))
    if (!args['_'] || args['_'].length === 0 || !args['_'][0]['_'] || args['_'][0]['_'].length === 0) {
      console.log(HELP)
      process.exit(0)
    }

    const chain = args['_'][0]['_'].join(' ')
    const pathToWatch = (args.w === true && process.cwd()) || (typeof args.w === 'string' && path.resolve(args.w))
    const projects = args.p ? args.p.trim().split(',') : []

    this.init(chain, projects, pathToWatch)
  }

  async init (chain, projects, pathToWatch) {
    this.cfg = this.getCfg()
    this.queue = []
    this.children = {}

    await this.runChain(chain, [], projects)
    pathToWatch && this.observe(pathToWatch, projects)
  }

  //
  // Chain processing.
  //

  // chain ~ '+foo - bar baz'
  async runChain (chain, files = [], projects = [], exitOnError = true) {
    files.length === 0 && files.push('')
    const timestamp = Date.now()
    // Get scripts: [{
    //   name: 'some:script::variant:file.js'
    //   isBackground: false,
    //   isPause: false,
    //   code: 'node some-script.js -p red'
    // }]
    const scripts = []
    for (const text of chain.split(' ')) {
      const name = text.replace(/[+]*(.*)/g, '$1')
      const isBackground = text.includes('+')
      const isPause = text === '-'
      const code = this.cfg.scripts[name]

      if (!code && !isPause) {
        console.error(`${RNA} ${ERR} Script ${name} does not exist.`)
        this.handleError(exitOnError)
        continue
      }

      // Plain script.
      if (isPause || (!code.includes('$PROJ') && !code.includes('$FILE'))) {
        scripts.push({name, isBackground, isPause, code})
        continue
      }

      // Flavored script.
      if (code.includes('$PROJ') && !code.includes('$FILE')) {
        for (const project of projects) {
          scripts.push({name: `${name}::${project}`, isBackground, isPause, code: code.replace(/\$PROJ/g, project)})
        }
      }

      // File script.
      if (!code.includes('$PROJ') && code.includes('$FILE')) {
        for (const file of files) {
          const suffix = file ? `::${path.basename(file)}` : ''
          scripts.push({name: `${name}${suffix}`, isBackground, isPause, code: code.replace(/\$FILE/g, file)})
        }
      }

      // Flavoured file script.
      if (code.includes('$PROJ') && code.includes('$FILE')) {
        for (const project of projects) {
          const projCode = code.replace(/\$PROJ/g, project)
          for (const file of files) {
            const suffix = file ? `:${path.basename(file)}` : ''
            scripts.push({name: `${name}::${project}${suffix}`, isBackground, isPause, code: projCode.replace(/\$FILE/g, file)})
          }
        }
      }
    }

    // Run all the scripts in a chain.
    let msg = projects.length ? `${chalk.magenta(chain)} :: ${chalk.magenta(projects)}` : chalk.magenta(chain)

    console.log(`${RNA} ${LOG} Chain ${msg} started.`)
    for (const script of scripts) {
      if (script.isPause) {
        await this.waitForAllChildrenToComplete()
      } else if (script.code) {
        this.runScript(script, exitOnError)
      } else {
        console.error(`${RNA} ${ERR} Script ${script.name} does not exists.`)
        this.handleError(exitOnError)
      }
    }

    await this.waitForAllChildrenToComplete()
    const duration = Date.now() - timestamp
    console.log(`${RNA} ${LOG} Chain ${msg} completed in ${duration} ms.`)
  }

  async waitForAllChildrenToComplete () {
    console.log(`${RNA} ${LOG} Waiting for all running scripts to complete...`)
    // We need to exclude background scripts.
    while (Object.values(this.children).filter(c => !c.isBackground).length !== 0) {
      await this.wait(CHILD_EXIT_WAIT)
    }
  }

  // Spawn child process.
  async runScript (script, exitOnError) {
    // Scripts running in the background should not exit on error.
    // exitOnError = script.isBackground ? false : exitOnError
    const [args, shell] = this.getSpawnArgs(script.code)
    return new Promise(resolve => {
      const timestamp = Date.now()

      // Spawn child process.
      console.log(`${RNA} ${LOG} Script ${script.name} started.`)
      const child = spawn(args[0], args.slice(1), {shell})

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
      })

      // Capture stdout.
      child.stdout.on('data', buf => {
        this.getLogLines(buf, script.name, LOG).forEach(line => process.stdout.write(line))
      })

      // Capture stderr.
      child.stderr.on('data', buf => {
        this.getLogLines(buf, script.name, ERR).forEach(line => process.stderr.write(line))
        // Background processes can log errors as much as they want.
        !script.isBackground && this.handleError(exitOnError)
      })

      // Memorize.
      this.children[child.pid] = {...script, process: child}
    })
  }

  getSpawnArgs (cmd) {
    const args = cmd.split(' ')
    const packageName = args[0]

    // Resolve local package binary.
    if (this.cfg.binaries[packageName]) {
      args[0] = this.cfg.binaries[packageName]
    }

    return [args, false]
  }

  //
  // Watching.
  //

  async observe (pathToWatch, projects) {
    // Get rules: [{
    //   chain: '+foo - bar baz'
    //   pattern: 'c:/absolute/path/to/red/**'
    //   projects: ['red']
    // },{
    //   chain: '+foo - bar baz'
    //   pattern: 'c:/absolute/path/to/blue/**'
    //   projects: [blue']
    // },{
    //   chain: '+foo - bar baz'
    //   pattern: 'c:/absolute/path/to/base/**'
    //   projects: ['red', 'blue']
    // }]
    const rules = []
    for (const [chain, patterns] of Object.entries(this.cfg.observe)) {
      for (let pattern of patterns) {
        // Align with directory structure and normalize slashes.
        pattern = path.resolve(pathToWatch, pattern).replace(/\\/g, '/')

        // Non-project pattern means all the projects apply.
        if (!pattern.includes('$PROJ')) {
          rules.push({chain, pattern, projects})
          continue
        }
        // Add rule for each project separately.
        for (const project of projects) {
          rules.push({chain, pattern: pattern.replace(/\$PROJ/g, project), projects: [project]})
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
    const chainsToRun = {} // {projects: <>, files: []}
    const loggedChanges = new Set()
    for (const rule of rules) {
      const match = this.match(paths, rule.pattern)
      if (match.length === 0) {
        continue
      }

      // Add entry if it does not exist.
      chainsToRun[rule.chain] = chainsToRun[rule.chain] || {projects: new Set(), files: new Set()}

      // Add projects to entry.
      for (const project of rule.projects) {
        chainsToRun[rule.chain].projects.add(project)
      }

      // Add files to entry.
      for (const m of match) {
        // Make sure each change that triggers a script is logged only once.
        if (!loggedChanges[m]) {
          console.log(`${RNA} ${LOG} Changed ${chalk.yellow(path.resolve(m))}`)
          loggedChanges.add(m)
        }
        chainsToRun[rule.chain].files.add(m)
      }
    }

    const any = Object.keys(chainsToRun).length > 0
    for (const [chain, item] of Object.entries(chainsToRun)) {
      await this.runChain(chain, Array.from(item.files), Array.from(item.projects), false)
    }

    this.lock = false
    return any
  }

  //
  // Exit handling.
  //

  handleError (exitOnError) {
    if (exitOnError) {
      console.log(`${RNA} ${ERR} Shutting down.`)
      process.exitCode = 1
      process.exit(1)
    }
  }

  //
  // Helpers.
  //

  getJson (filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }

  resolveLocalBinaries (cfg) {
    cfg.binaries = {}

    const binPath = path.resolve(process.cwd(), 'node_modules', '.bin')
    for (const script of fs.readdirSync(binPath)) {
      const scriptPath = path.resolve(binPath, script)
      if (process.platform === 'win32' && script.endsWith('.cmd')) {
        cfg.binaries[script.slice(0, -4)] = scriptPath
      } else {
        cfg.binaries[script] = path.resolve(binPath, script)
      }
    }

    return cfg
  }

  getCfg () {
    const cfg = this.getJson(path.join(process.cwd(), 'package.json'))
    cfg.projects = cfg.projects || {}
    return this.resolveLocalBinaries(cfg)
  }

  getLogLines (buf, name, log) {
    const trimmed = buf.toString('utf8').trim()
    return trimmed ? trimmed.split('\n').map(line => `${chalk.blue(name)} ${log} ${line}\n`) : []
  }

  async wait (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  match (paths, pattern) {
    const result = []
    const re = globToRegExp(pattern)
    for (const path of paths) {
      re.test(path) && result.push(path)
    }

    return result
  }
}

if (require.main === module) {
  const runner = new Runner()
  runner.main()
}

module.exports = Runner
