const chalk = require('chalk')
setTimeout(() => {
  let color = chalk.yellow('color')
  console.log(process.argv[2] + `\r\nline 2\n${color} 3\r\n`)
}, parseInt(process.argv[3], 10))
