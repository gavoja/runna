const chalk = require('chalk')
const delay = process.argv[3]
const action = process.argv[2]

setTimeout(() => {
  let log = 'log'

  if (action === 'build:js:proj3') {
    throw (new Error('JS build failed.'))
  }

  if (action === 'build:js:proj4') {
    log = 'error'
  }

  console[log](action + `\r\nline 2\n${chalk.yellow('line 3')}\r\n`)
}, parseInt(delay, 10))
