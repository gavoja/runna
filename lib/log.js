'use strict'

const chalk = require('chalk')
const logUpdate = require('log-update')

const ERR = chalk.red('err')
const DBG = chalk.green('dbg')

class Logger {
  static getInstance () {
    Logger.instance = Logger.instance || new Logger()
    return Logger.instance
  }

  enableDebug () {
    this.isDebug = true
  }

  clearStatus (clearLine = true) {
    logUpdate.clear()
  }

  dbg (name, msg) {
    if (!this.isDebug) {
      return
    }

    this.clearStatus()
    this.getLines(msg).forEach(line => {
      console.log(`${chalk.blue(name)} ${DBG}`, line)
    })

    this.printStatus()
  }

  err (name, msg) {
    this.clearStatus()
    this.getLines(msg).forEach(line => {
      console.error(`${chalk.blue(name)} ${ERR}`, line)
    })

    this.printStatus()
  }

  getLines (msg) {
    if (Buffer.isBuffer(msg)) {
      const text = msg.toString('utf8')
      // TODO: Handle cases where a coloured string is split.
      const lines = text ? text.split('\n') : []
      // Remove last line if empty.
      if (!lines[lines.length - 1]) {
        lines.pop()
      }

      return lines
    } else {
      return [msg]
    }
  }

  printStatus (status) {
    if (status) {
      this.status = status
    }

    this.isDebug || logUpdate(this.status)
  }

  end () {
    logUpdate.done()
    console.log('')
  }
}

module.exports = Logger
