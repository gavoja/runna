'use strict'

const chalk = require('chalk')

const ERR = chalk.red('err')
const DBG = chalk.green('dbg')

class Logger {
  static getInstance () {
    Logger.instance = Logger.instance || new Logger()
    return Logger.instance
  }

  dbg (name, msg) {
    this.getLines(msg).forEach(line => {
      console.log(`${chalk.blue(name)} ${DBG}`, line)
    })
  }

  err (name, msg) {
    this.getLines(msg).forEach(line => {
      console.error(`${chalk.blue(name)} ${ERR}`, line)
    })
  }

  getLines (msg) {
    if (Buffer.isBuffer(msg)) {
      const trimmed = msg.toString('utf8').trim()
      return trimmed ? trimmed.split('\n') : []
    } else {
      return [msg]
    }
  }
}

module.exports = Logger
