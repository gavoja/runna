'use strict'

const path = require('path')
const fs = require('fs')
const subarg = require('subarg')
const args = subarg(process.argv.slice(2))

setTimeout(() => {
  if (args.error === 'throw') {
    throw new Error('Failing with exception.')
  }

  if (args.error === 'log') {
    console.error('Failing with error log.')
    process.exit(0)
  }

  if (args.error === 'exit') {
    process.exit(1)
  }

  if (args.clean) {
    console.log('Cleaning.')
    const distPath = path.resolve(__dirname, 'dist')
    for (const file of fs.readdirSync(distPath)) {
      const filePath = path.resolve(distPath, file)
      fs.unlinkSync(filePath)
    }

    process.exit(0)
  }

  if (args.generate) {
    console.log('Generating:', args.generate)
    const filePath = path.resolve(__dirname, 'dist', args.generate)
    fs.writeFileSync(filePath)
    process.exit()
  }

  if (args.background) {
    console.log('Chillin\' in the background...')
    console.error('...and sometimes log an error.')
    setInterval(() => {}, 1000)
  }
}, parseInt(args.delay || 0, 10))
