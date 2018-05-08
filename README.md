# Runna - process based task runner for Node

## Features

* Fast and simple.
* NPM scripts compatible - there is no need to reinvent the wheel.
* Process based - failure of one task does not have to bring the whole process down.
* Watcher included - built-in consistent performant recursive watching.

## Usage

```
Usage:
  runna <chain> [options]

Options:
  -f <flavors>             Enable flavors; a comma separated list.
  -w [<path-to-watch>]     Default is current.
```

## Quck start

### STEP 1: Define your usual NPM scripts

```json
scripts: {
  "clean": "rimraf ./dist",
  "create-dist-dir": "mkdirp ./dist",
  "build:js": "browserify ./src/index.js -o ./dist/index.js -t [ babelify --presets [ babel-preset-env ] ]",
  "copy:html": "copyfiles --flat ./src/index.html ./dist",
  "serve": "runna-webserver -w ./dist",
  "serve:stop": "runna-webserver -x",
  "serve:reload": "runna-webserver -r",
}
```

### STEP 2: Define your build chain

```json
scripts: {
  "build": "runna [ clean - create-dist-dir - build:js copy:html ]",
}
```

The above `build` chain translates to:
```
clean             | npm run clean
-                 | wait for all previous scripts to complete
create-dist-dir   | npm run create-dist-dir
-                 | wait for all previous scripts to complete
build:js          | npm run build:js
copy:html         | npm run copy:html
```

### STEP 3: Run your chain

```
npm run build
```

And that's it! The `build` chain executes all scripts as background processes. Note that the `-` symbol allows to wait for all the previous scripts to complete and behaves consistently on all OSes.

## Advanced usage

### Interactive development mode

The development mode allows triggering chain upon a file change. To enable watch mode, simply add `-w` parameter. Let's define `develop` chain like so:

```json
scripts: {
  "develop": "runna [ +serve clean - create-dist-dir - build:js copy:html - serve:reload ] -w,
}
```

The `+` symbol before a script name indicates, that the script should be run in the backgroud. Waiting for all previous tasks to complete with `-` igonres all background scripts automatically.

Now, let's define our observe rules like so:

```json
observe: {
  "build:js - serve:reload": [
    "src/**/*.js"
  ],
  "copy:html - serve:reload": [
    "src/**/*.html"
  ]
}
```

Each rule is a chain that is executed whenever a file changes that matches one of the patterns in the array. Patterns must be relative to the current working directory, or the location specified as a `-w <path_to_watch>` parameter. The watching leverages `recursive` flag of `fs.watch()`, which greatly improves the performance on Windows and OS X.

## Flavours

Flavours are a concept that allows reusing scripts for different sub-projects. Let's define a flavor based script like so:

```json
scripts: {
  "build:js": "browserify ./src/$FLV/index.js -o ./dist/$FLV/index.js -t [ babelify --presets [ babel-preset-env ] ]",
}
```
Note the `$FLV` placeholder - it's presence automatically enables flavor based behavior.

Let's update our `develop` chain to support flavors. To do so, simply add `-f` parameter:
```json
scripts: {
  "develop": "runna [ +serve clean - create-dist-dir - build:js copy:html - serve:reload ] -w -f red,blue,
}
```

When running the above chain with `npm run develop`, the `build:js` script will be run twice, once for each flavor. Scripts that do not use `$FLV` placeholder will only run once as per usual. Think of it as of two separate scripts: `build:js::red` and `build:js::blue`.

Let's update our observe rule accordingly:

```json
observe: {
  "build:js - serve:reload": [
    "src/$FLV/*.js"
  ]
}

```

Now, when a file changes on a path `src/blue/*.js`, the `build:js` script will be run only in the `blue` flavor. The `$FLV` placeholder will be replaced with the actual folder value.
