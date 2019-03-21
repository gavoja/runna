'use strict'

const fs = require('fs')
const path = require

class Utils {
  static getPackageJson () {
    return Utils.getJson(path.join(__dirname, 'package.json'))
  }

  static getJson (filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }
}

module.exports = Utils
