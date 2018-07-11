'use strict'

const chalk = require('chalk')

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

  clearCurrentLine () {
    if (process.stdout.isTTY) {
      process.stdout.cursorTo(0)
      process.stdout.clearLine()
    }
  }

  dbg (name, msg) {
    if (!this.isDebug) {
      return
    }

    this.clearCurrentLine()
    this.getLines(msg).forEach(line => {
      console.log(`${chalk.blue(name)} ${DBG}`, line)
    })

    this.printStatus()
  }

  err (name, msg) {
    this.clearCurrentLine()
    this.getLines(msg).forEach(line => {
      console.error(`${chalk.blue(name)} ${ERR}`, line)
    })

    this.printStatus()
  }

  getLines (msg) {
    if (Buffer.isBuffer(msg)) {
      const trimmed = msg.toString('utf8').trim()
      return trimmed ? trimmed.split('\n') : []
    } else {
      return [msg]
    }
  }

  setStatus (msg) {
    this.status = msg
  }

  printStatus () {
    this.clearCurrentLine()
    this.status && process.stdout.write(this.status)
    process.stdout.isTTY || this.end()
  }

  end () {
    console.log('')
  }
}

module.exports = Logger
