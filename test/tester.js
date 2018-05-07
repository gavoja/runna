const minimist = require('minimist')
const args = minimist(process.argv.slice(2))

console.log(`Starting`)
args.flavors && console.log(`Flavors detected: ${args.flavors}`)

setTimeout(() => {
  console.log(`Finalizing`)
  if (args['error-throw']) {
    throw new Error('Build failed.')
  }

  if (args['error-log']) {
    console.error('Unexpected error occured.')
  }

  if (args['error-exit']) {
    process.exit(1)
  }
}, parseInt(args.delay || 0, 10))
