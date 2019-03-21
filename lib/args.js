'use strict'

function getParamName (param) {
  return param ? (param.match(/^-{1,2}([^ ]*)$/) || []).pop() : null
}

/**
 * Gets process argumens in form of an object:
 * {p: 'foo,bar', w: '/some/path', _: '+foo - bar baz'}
 */
function getArgs () {
  const args = { chain: [] }
  const argv = process.argv.slice(2)

  for (let ii = argv.length - 1; ii >= 0; --ii) {
    const curr = argv[ii]
    const next = ii < argv.length - 1 ? argv[ii + 1] : null
    const paramName = getParamName(curr)

    if (paramName) {
      let paramValue = true
      if (next && !getParamName(next)) {
        paramValue = next
        argv.splice(ii + 1, 1)
      }

      args[paramName] = paramValue
      argv.splice(ii, 1)
    }

    args._ = argv.filter(item => item !== '[' && item !== ']').join(' ')
  }

  return args
}

module.exports = getArgs()
