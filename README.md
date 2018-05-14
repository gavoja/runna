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
  -p <projects>            Run with projects; a comma separated list.
  -w [<path-to-watch>]     Default is current.
```

## Quck start

### STEP 1: Define your usual NPM scripts

```json
{
  "scripts": {
    "clean": "rimraf ./dist",
    "create-dist-dir": "mkdirp ./dist",
    "build:js": "browserify ./src/index.js -o ./dist/index.js -t [ babelify --presets [ babel-preset-env ] ]",
    "copy:html": "copyfiles --flat ./src/index.html ./dist",
    "serve": "runna-webserver -w ./dist",
    "serve:stop": "runna-webserver -x",
    "serve:reload": "runna-webserver -r"
  }
}
```

### STEP 2: Define your build chain

```json
{
  "scripts": {
    "build": "runna [ clean - create-dist-dir - build:js copy:html ]"
  }
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
{
  "scripts": {
    "develop": "runna [ +serve clean - create-dist-dir - build:js copy:html - serve:reload ] -w",
  }
}
```

The `+` symbol before a script name indicates, that the script should be run in the backgroud. Waiting for all previous tasks to complete with `-` igonres all background scripts automatically.

Now, let's define our observe rules like so:

```json
{
  "observe": {
    "build:js - serve:reload": [
      "src/**/*.js"
    ],
    "copy:html - serve:reload": [
      "src/**/*.html"
    ]
  }
}
```

Notes:
* Each rule is a chain that is executed whenever a file changes that matches one of the patterns in the array. Patterns must be relative to the current working directory, or the location specified as a `-w <path-to-watch>` parameter.
* Any chain with `-w` flag will be run at least once, before watching begins.
* Watching leverages `recursive` flag of `fs.watch()`, which greatly improves performance on Windows and OS X compared to packages based on [Chokidar](https://github.com/paulmillr/chokidar) (e.g. [onchange](https://github.com/Qard/onchange) or [watchify](https://github.com/browserify/watchify)), especially for large projects.

### $FILE variable

It is possible to pass a file path to a script, that triggeted a chain execution when in watch mode. To do so, use `$FILE` variable like so:

```json
{
  "scripts": {
    "build:html": "node scripts/build-html $FILE",
  }
}
```

Notes:
* When in watch mode, the `$FILE` variable will be replaced with the full path of the file that triggered the chain.
* When not in watch mode (this also applies to the first run when in watch mode), the `$FILE` will default to blank, so make sure your script handles it correctly (e.g. builds everything if no file is provided).

### $PROJ variable

It is possible to run the same script for multiple sub-projects using the `$PROJ` variable. Let's define a project-based script like so:

```json
{
  "scripts": {
    "build:js": "browserify ./src/$PROJ/index.js -o ./dist/$PROJ/index.js -t [ babelify --presets [ babel-preset-env ] ]"
  }
}
```
The presence of `$PROJ` placeholder enables project-based behaviour automatically. Let's update our `develop` chain to support projects. To do so, simply add `-p` parameter:

```json
{
  "scripts": {
    "develop": "runna [ +serve clean - create-dist-dir - build:js copy:html - serve:reload ] -w -p red,blue"
  }
}
```

When running the above chain with `npm run develop`, the `build:js` script will be run twice, once for each project. Scripts that do not use `$PROJ` placeholder will only run once as per usual. Think of it as of two separate scripts: `build:js::red` and `build:js::blue`.

Let's update our observe rule accordingly:

```json
{
  "observe": {
    "build:js - serve:reload": [
      "src/$PROJ/*.js",
      "src/foo/**/*.js"
    ]
  }
}
```

Notes:
* When a file changes on the path matching `src/blue/*.js`, the `build:js` script will be run only for the the `blue` project. The `$PROJ` placeholder will be replaced with the actual folder name.
* When a file changes on the path matching `src/foo/**/*.js`, the `build:js` script will be run for all projects provided (in this case `red` and `blue`).
* If no projects are provided with `-p` option, all project-based scripts are ignored.
