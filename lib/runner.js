'use strict'

const path = require('path')
const fs = require('fs')
const exec = require('child_process').exec
const chalk = require('chalk')

const WAIT_SYMBOL = '*'

class Runner {

  init () {
    let file = path.join(process.cwd(), 'package.json')
    this.cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
  }

  getPipeline (name) {
    let task = this.cfg.runna.tasks[name]
    if (!task) {
      console.error(`Task does not exist: ${name}`)
      return []
    }

    let pipeline = task.replace(/\s+/g, ' ').split(' ').map(script => {
      let item = {script}
      if (script.startsWith(WAIT_SYMBOL)) {
        item.script = script.substr(1)
        item.wait = true
      }

      return item
    })

    return pipeline
  }

  runScript (name) {
    return new Promise((resolve, reject) => {
      console.log(chalk.green(`${name} started`))
      let doReject = () => {
        console.log(chalk.green(`${name} error`))
        reject()
      }

      let doResolve = () => {
        console.log(chalk.green(`${name} finished`))
        resolve()
      }

      // Check if script name exists.
      // FIXME: Find out why this causes unhandled promise rejection
      let cmd = this.cfg.scripts[name]
      // if (!cmd) {
      //   console.error(`Script does not exist: ${name}`)
      //   return reject()
      // }

      // Execute child process.
      let child = exec(cmd, (error, stdout, stderr) => {
        if (error) {
          console.error(error)
          return doReject()
        }

        doResolve()
      })
      child.stdout.pipe(process.stdout)
      child.stderr.pipe(process.stderr)
    })
  }

  runTask (name) {
    console.log(`Running task: ${name}`)
    let pipeline = this.getPipeline(name)
    this.runPipeline(pipeline)
  }

  runPipeline (pipeline) {
    if (!pipeline.length) {
      return
    }

    let current = []
    let remaining = []
    for (let ii = 0; ii < pipeline.length; ++ii) {
      if (ii > 0 && pipeline[ii].wait) {
        remaining = pipeline.slice(ii)
        break
      }

      current.push(pipeline[ii])
    }

    current.length && Promise
      .all(current.map(item => this.runScript(item.script)))
      .then(() => {
        this.runPipeline(remaining)
      })
  }

  watch () {
    // TODO: Implement
  }
}

module.exports = Runner
